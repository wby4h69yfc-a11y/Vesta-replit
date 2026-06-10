/**
 * wa-reminder-handler.ts
 *
 * Handles WhatsApp-native reminder setting ("Me lembra de X às Y") and
 * cancellation ("Cancela lembrete") commands from household members.
 *
 * Flow:
 *   1. Caller detects intent via isReminderIntent() / isCancelReminderIntent()
 *   2. handleSetReminderIntent() calls the LLM to parse the natural-language
 *      reminder, resolves relative times in the household's timezone, checks
 *      quiet hours, and either stores the reminder or opens a
 *      "reminder_quiet_confirm" conversation for 21h–07h cases.
 *   3. handleReminderQuietConfirm() resolves the pending quiet-hour
 *      conversation when the user replies "sim" or "não".
 *   4. handleCancelReminderIntent() deletes the most recent unfired reminder
 *      for the sender's phone.
 *
 * Scheduling:
 *   sendDueReminders() is called every minute by the scheduler and fires
 *   reminders whose remind_at <= now and fired_at IS NULL.  Recurring
 *   reminders (rrule set) have their next remind_at computed instead of
 *   fired_at being set.
 *
 * Security:
 *   All DB reads/writes are scoped to the caller's householdId.
 *   member_phone is normalised (digits-only) before DB operations.
 */

import type { Logger } from "pino";
import { db } from "@workspace/db";
import {
  remindersTable,
  householdsTable,
  waConversationsTable,
  onboardingStateTable,
} from "@workspace/db";
import { eq, and, isNull, lte, desc, sql } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import { sendWhatsApp } from "./whatsapp";
import { logger as rootLogger } from "./logger";

// ── Intent detection ──────────────────────────────────────────────────────────

const REMINDER_SET_RE =
  /\b(me lembra|lembra de mim|me avisa|me notifica|lembrar de|lembra que|avisa quando|me lembre)\b/i;

const CANCEL_REMINDER_RE =
  /\b(cancela|cancelar)\s+(o\s+)?lembrete\b/i;

/** Returns true when the text is likely a reminder-setting command. */
export function isReminderIntent(text: string): boolean {
  return REMINDER_SET_RE.test(text);
}

/** Returns true when the text is a "Cancela lembrete" command. */
export function isCancelReminderIntent(text: string): boolean {
  return CANCEL_REMINDER_RE.test(text);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalisePhone(p: string): string {
  return p.replace(/\D/g, "");
}

/** Returns local hour (0–23) in `tz` for `date`. */
function localHour(date: Date, tz: string): number {
  try {
    const h = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: tz,
    }).format(date);
    const n = parseInt(h, 10);
    return isNaN(n) ? date.getUTCHours() : n % 24;
  } catch {
    return date.getUTCHours();
  }
}

/** Returns true when `date` falls in the 21h–07h quiet window in `tz`. */
function isInQuietHours(date: Date, tz: string): boolean {
  const h = localHour(date, tz);
  return h >= 21 || h < 7;
}

/** Returns the next 07h00 occurrence (local time in `tz`) after `from`. */
function nextMorningSlot(from: Date, tz: string): Date {
  for (let offset = 1; offset <= 48; offset++) {
    const probe = new Date(from.getTime() + offset * 60 * 60 * 1000);
    probe.setMinutes(0, 0, 0);
    if (localHour(probe, tz) === 7) return probe;
  }
  return new Date(from.getTime() + 10 * 60 * 60 * 1000);
}

/** Formats a Date as a human-readable pt-BR string. */
function formatDatePtBR(date: Date, tz: string): string {
  return date.toLocaleString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: tz,
  });
}

// ── LLM: parse reminder ───────────────────────────────────────────────────────

interface ParsedReminder {
  message: string;
  remind_at: string;
  rrule: string | null;
}

const PARSE_SYSTEM = `Você é um analisador de lembretes para o assistente doméstico Vesta.
Analise a mensagem e extraia as informações do lembrete. Retorne APENAS JSON sem markdown:
{
  "message": "texto do que deve ser lembrado (curto, max 120 chars)",
  "remind_at": "data/hora em ISO 8601 com timezone (ex: 2026-06-11T10:00:00-03:00)",
  "rrule": "FREQ=WEEKLY|FREQ=DAILY|FREQ=MONTHLY ou null para lembrete único"
}
Regras:
- Resolva referências relativas usando a data/hora local fornecida no contexto.
- "amanhã" = amanhã, "semana que vem" = daqui 7 dias, "todo mês" → FREQ=MONTHLY, "toda semana" → FREQ=WEEKLY, "todo dia" → FREQ=DAILY.
- Se a hora não for mencionada, use 09:00 local.
- Se o ano não for mencionado, assuma o ano corrente.
- "message" deve ser o que Vesta vai lembrar o usuário de fazer, sem os detalhes de horário.
Responda APENAS com JSON válido.`;

async function parseReminderIntent(
  text: string,
  householdTz: string,
  log: Logger,
): Promise<ParsedReminder | null> {
  const now = new Date();
  const localNow = now.toLocaleString("pt-BR", {
    timeZone: householdTz,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const isoNow = now.toISOString();

  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 120,
      messages: [
        { role: "system", content: PARSE_SYSTEM },
        {
          role: "user",
          content:
            `Data/hora local atual: ${localNow} (${isoNow})\nTimezone: ${householdTz}\n\nMensagem: "${text.substring(0, 300)}"`,
        },
      ],
    });
    const raw = (resp.choices[0]?.message?.content ?? "").trim();
    const json = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    const parsed = JSON.parse(json) as Partial<ParsedReminder>;

    if (!parsed.message || !parsed.remind_at) {
      log.warn({ raw }, "wa-reminder: LLM missing required fields");
      return null;
    }

    const remindAt = new Date(parsed.remind_at);
    if (isNaN(remindAt.getTime())) {
      log.warn({ raw, remind_at: parsed.remind_at }, "wa-reminder: invalid remind_at from LLM");
      return null;
    }

    const validRrules = ["FREQ=WEEKLY", "FREQ=DAILY", "FREQ=MONTHLY"];
    const rrule = parsed.rrule && validRrules.includes(parsed.rrule) ? parsed.rrule : null;

    return {
      message: String(parsed.message).substring(0, 120),
      remind_at: remindAt.toISOString(),
      rrule,
    };
  } catch (err) {
    log.warn({ err }, "wa-reminder: LLM parse failed");
    return null;
  }
}

// ── Quiet-hour payload stored in wa_conversations ─────────────────────────────

interface ReminderQuietPayload {
  message: string;
  original_remind_at: string;
  adjusted_remind_at: string;
  rrule: string | null;
  member_phone: string;
}

// ── Public handler: set reminder ──────────────────────────────────────────────

/**
 * Parses a natural-language reminder command, checks quiet hours, and either
 * inserts the reminder row directly or opens a quiet-hour confirmation
 * conversation.
 *
 * Returns a reply string for the caller to send back to the user.
 */
export async function handleSetReminderIntent(
  text: string,
  householdId: number,
  memberPhoneRaw: string,
  log: Logger,
): Promise<string> {
  const phoneNorm = normalisePhone(memberPhoneRaw);

  const [household] = await db
    .select({ timezone: householdsTable.timezone })
    .from(householdsTable)
    .where(eq(householdsTable.id, householdId))
    .limit(1);

  const tz = household?.timezone ?? "America/Sao_Paulo";

  const parsed = await parseReminderIntent(text, tz, log);
  if (!parsed) {
    return (
      "⚠️ Não consegui entender o lembrete. Pode tentar de novo?\n\n" +
      "Exemplo: _Me lembra de ligar pro pediatra amanhã às 10h_"
    );
  }

  const remindAt = new Date(parsed.remind_at);

  if (isInQuietHours(remindAt, tz)) {
    const adjustedAt = nextMorningSlot(remindAt, tz);
    const adjustedStr = formatDatePtBR(adjustedAt, tz);

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const payload: ReminderQuietPayload = {
      message: parsed.message,
      original_remind_at: parsed.remind_at,
      adjusted_remind_at: adjustedAt.toISOString(),
      rrule: parsed.rrule,
      member_phone: phoneNorm,
    };

    await db
      .update(waConversationsTable)
      .set({ state: "dismissed" })
      .where(
        and(
          eq(waConversationsTable.household_id, householdId),
          eq(waConversationsTable.sender_phone, phoneNorm),
          eq(waConversationsTable.thread_context, "reminder_quiet_confirm"),
          eq(waConversationsTable.state, "awaiting_confirmation"),
        ),
      );

    await db.insert(waConversationsTable).values({
      household_id: householdId,
      sender_phone: phoneNorm,
      state: "awaiting_confirmation",
      thread_context: "reminder_quiet_confirm",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      proposed_payload: payload as any,
      expires_at: expiresAt,
    });

    log.info(
      { householdId, phone: memberPhoneRaw, message: parsed.message, remindAt: parsed.remind_at },
      "wa-reminder: remind_at in quiet window — awaiting user confirmation to reschedule",
    );

    return (
      `⏰ *${parsed.message}* seria às ${formatDatePtBR(remindAt, tz)}, ` +
      `mas esse horário está dentro do período de silêncio (21h–07h).\n\n` +
      `Reagendo para *${adjustedStr}*?\n\nResponda *sim* para confirmar ou *não* para cancelar.`
    );
  }

  await db.insert(remindersTable).values({
    household_id: householdId,
    member_phone: phoneNorm,
    message: parsed.message,
    remind_at: remindAt,
    rrule: parsed.rrule ?? undefined,
  });

  const formattedAt = formatDatePtBR(remindAt, tz);
  const recurringNote = parsed.rrule
    ? rruleLabel(parsed.rrule)
    : "";

  log.info(
    { householdId, phone: memberPhoneRaw, message: parsed.message, remindAt: remindAt.toISOString(), rrule: parsed.rrule },
    "wa-reminder: reminder stored",
  );

  return (
    `⏰ Vou te lembrar: *${parsed.message}*\n\n` +
    `📅 ${formattedAt}${recurringNote}\n\n` +
    `_Responda "Cancela lembrete" para cancelar._`
  );
}

function rruleLabel(rrule: string): string {
  switch (rrule) {
    case "FREQ=DAILY":   return "\n🔁 Repete todos os dias";
    case "FREQ=WEEKLY":  return "\n🔁 Repete toda semana";
    case "FREQ=MONTHLY": return "\n🔁 Repete todo mês";
    default:             return "";
  }
}

// ── Public handler: quiet-hour confirmation reply ─────────────────────────────

/**
 * Handles a SIM / NÃO reply for a pending "reminder_quiet_confirm" conversation.
 *
 * Returns a reply string if an open conversation was found and handled,
 * or undefined if no such conversation exists (caller continues normal flow).
 */
export async function handleReminderQuietConfirm(
  bodyText: string,
  householdId: number,
  memberPhoneRaw: string,
  log: Logger,
): Promise<string | undefined> {
  const phoneNorm = normalisePhone(memberPhoneRaw);
  const upper = bodyText.trim().toUpperCase();

  const isSim = upper === "SIM";
  const isNao = upper === "NÃO" || upper === "NAO" || upper === "N";
  if (!isSim && !isNao) return undefined;

  const [conv] = await db
    .select()
    .from(waConversationsTable)
    .where(
      and(
        eq(waConversationsTable.household_id, householdId),
        eq(waConversationsTable.sender_phone, phoneNorm),
        eq(waConversationsTable.thread_context, "reminder_quiet_confirm"),
        eq(waConversationsTable.state, "awaiting_confirmation"),
        sql`${waConversationsTable.expires_at} > NOW()`,
      ),
    )
    .orderBy(desc(waConversationsTable.created_at))
    .limit(1);

  if (!conv) return undefined;

  await db
    .update(waConversationsTable)
    .set({ state: isNao ? "dismissed" : "completed" })
    .where(eq(waConversationsTable.id, conv.id));

  if (isNao) {
    log.info({ householdId, convId: conv.id }, "wa-reminder: user declined quiet-hour reschedule");
    return "👍 Ok, lembrete cancelado.";
  }

  const payload = conv.proposed_payload as unknown as ReminderQuietPayload | null;
  if (!payload?.message || !payload.adjusted_remind_at) {
    log.warn({ householdId, convId: conv.id }, "wa-reminder: quiet conv missing payload");
    return "⚠️ Não consegui recuperar o lembrete. Tente configurar de novo.";
  }

  const [household] = await db
    .select({ timezone: householdsTable.timezone })
    .from(householdsTable)
    .where(eq(householdsTable.id, householdId))
    .limit(1);

  const tz = household?.timezone ?? "America/Sao_Paulo";

  const remindAt = new Date(payload.adjusted_remind_at);
  await db.insert(remindersTable).values({
    household_id: householdId,
    member_phone: phoneNorm,
    message: payload.message,
    remind_at: remindAt,
    rrule: payload.rrule ?? undefined,
  });

  const formattedAt = formatDatePtBR(remindAt, tz);
  const recurringNote = payload.rrule ? rruleLabel(payload.rrule) : "";

  log.info(
    { householdId, phone: memberPhoneRaw, message: payload.message, remindAt: remindAt.toISOString() },
    "wa-reminder: quiet-hour reschedule confirmed — reminder stored",
  );

  return (
    `⏰ Vou te lembrar: *${payload.message}*\n\n` +
    `📅 ${formattedAt}${recurringNote}\n\n` +
    `_Responda "Cancela lembrete" para cancelar._`
  );
}

// ── Public handler: cancel reminder ──────────────────────────────────────────

/**
 * Cancels the most recent unfired reminder for the given phone number.
 * Returns a reply string for the caller to forward to the user.
 */
export async function handleCancelReminderIntent(
  householdId: number,
  memberPhoneRaw: string,
  log: Logger,
): Promise<string> {
  const phoneNorm = normalisePhone(memberPhoneRaw);

  const [reminder] = await db
    .select({ id: remindersTable.id, message: remindersTable.message })
    .from(remindersTable)
    .where(
      and(
        eq(remindersTable.household_id, householdId),
        eq(remindersTable.member_phone, phoneNorm),
        isNull(remindersTable.fired_at),
      ),
    )
    .orderBy(desc(remindersTable.created_at))
    .limit(1);

  if (!reminder) {
    return "🔍 Não encontrei nenhum lembrete ativo para cancelar.";
  }

  await db
    .delete(remindersTable)
    .where(
      and(
        eq(remindersTable.id, reminder.id),
        eq(remindersTable.household_id, householdId),
      ),
    );

  log.info(
    { householdId, reminderId: reminder.id, message: reminder.message },
    "wa-reminder: reminder cancelled by user",
  );

  return `🗑️ Lembrete cancelado: _${reminder.message}_`;
}

// ── Scheduler: fire due reminders ─────────────────────────────────────────────

/**
 * Polls for reminders whose remind_at <= now() and fired_at IS NULL,
 * sends the WhatsApp message, then either sets fired_at (one-shot) or
 * advances remind_at to the next recurrence (recurring reminders).
 *
 * Called every minute from the scheduler.
 */
export async function sendDueReminders(): Promise<void> {
  const now = new Date();

  const due = await db
    .select()
    .from(remindersTable)
    .where(
      and(
        lte(remindersTable.remind_at, now),
        isNull(remindersTable.fired_at),
      ),
    )
    .limit(50);

  if (due.length === 0) return;

  rootLogger.info({ count: due.length }, "wa-reminder: sending due reminders");

  for (const reminder of due) {
    try {
      const phone = reminder.member_phone;
      const message = `⏰ Lembrete: *${reminder.message}*\n\n_Enviado pelo Vesta._`;
      const result = await sendWhatsApp(phone, message);

      if (result.ok) {
        if (reminder.rrule) {
          const nextAt = computeNextOccurrence(reminder.remind_at, reminder.rrule);
          if (nextAt) {
            await db
              .update(remindersTable)
              .set({ remind_at: nextAt })
              .where(eq(remindersTable.id, reminder.id));
            rootLogger.info(
              { reminderId: reminder.id, nextAt: nextAt.toISOString(), rrule: reminder.rrule },
              "wa-reminder: recurring — next occurrence scheduled",
            );
          } else {
            await db
              .update(remindersTable)
              .set({ fired_at: now })
              .where(eq(remindersTable.id, reminder.id));
          }
        } else {
          await db
            .update(remindersTable)
            .set({ fired_at: now })
            .where(eq(remindersTable.id, reminder.id));
          rootLogger.info({ reminderId: reminder.id }, "wa-reminder: one-shot fired");
        }
      } else {
        rootLogger.warn(
          { reminderId: reminder.id, error: result.error },
          "wa-reminder: send failed — will retry next tick",
        );
      }
    } catch (err) {
      rootLogger.error({ err, reminderId: reminder.id }, "wa-reminder: unexpected error sending reminder");
    }
  }
}

/** Computes the next occurrence from a simple RRULE string. */
function computeNextOccurrence(currentAt: Date, rrule: string): Date | null {
  const ms = currentAt.getTime();
  switch (rrule) {
    case "FREQ=DAILY":
      return new Date(ms + 24 * 60 * 60 * 1000);
    case "FREQ=WEEKLY":
      return new Date(ms + 7 * 24 * 60 * 60 * 1000);
    case "FREQ=MONTHLY": {
      const next = new Date(currentAt);
      next.setUTCMonth(next.getUTCMonth() + 1);
      return next;
    }
    default:
      return null;
  }
}
