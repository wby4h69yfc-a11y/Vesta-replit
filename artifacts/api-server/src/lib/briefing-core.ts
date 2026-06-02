import { db } from "@workspace/db";
import { calendarEventsTable, contactsTable, householdsTable, onboardingStateTable, tasksTable } from "@workspace/db";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { sendWhatsApp, resolveHouseholdAdminPhone } from "./whatsapp";
import { logger } from "./logger";

const BRIEFING_COOLDOWN_INTERVAL = "1 hour";

export type BriefingResult =
  | { ok: true; sid: string; eventsCount: number; tasksCount: number }
  | { ok: false; reason: "cooldown"; retryAfterSec: number }
  | { ok: false; reason: "not_verified" }
  | { ok: false; reason: "no_phone" }
  | { ok: false; reason: "send_failed"; error: string };

/**
 * Core briefing logic shared between the HTTP route and the scheduler.
 *
 * Performs the atomic cooldown claim, assembles the message, and sends it.
 * Returns a typed result so callers decide how to surface the outcome.
 *
 * @param householdId - target household
 * @param fallbackPhone - optional phone from req.user (HTTP path only)
 */
export async function sendHouseholdBriefing(
  householdId: number,
  fallbackPhone?: string | null,
): Promise<BriefingResult> {
  const now = new Date();

  const claimed = await db
    .update(householdsTable)
    .set({ last_briefing_sent_at: now })
    .where(
      and(
        eq(householdsTable.id, householdId),
        sql`(
          ${householdsTable.last_briefing_sent_at} IS NULL
          OR ${householdsTable.last_briefing_sent_at} < NOW() - INTERVAL ${sql.raw(`'${BRIEFING_COOLDOWN_INTERVAL}'`)}
        )`,
      ),
    )
    .returning({ prev: householdsTable.last_briefing_sent_at });

  if (claimed.length === 0) {
    const [row] = await db
      .select({ last_briefing_sent_at: householdsTable.last_briefing_sent_at })
      .from(householdsTable)
      .where(eq(householdsTable.id, householdId));

    let retryAfterSec = 3600;
    if (row?.last_briefing_sent_at) {
      const cooldownMs = 60 * 60 * 1000;
      const elapsed = Date.now() - row.last_briefing_sent_at.getTime();
      retryAfterSec = Math.max(1, Math.ceil((cooldownMs - elapsed) / 1000));
    }
    return { ok: false, reason: "cooldown", retryAfterSec };
  }

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  const events = await db
    .select()
    .from(calendarEventsTable)
    .where(
      and(
        eq(calendarEventsTable.household_id, householdId),
        gte(calendarEventsTable.start_at, todayStart),
        lte(calendarEventsTable.start_at, todayEnd),
      ),
    );

  const tasks = await db
    .select()
    .from(tasksTable)
    .where(
      and(
        eq(tasksTable.household_id, householdId),
        eq(tasksTable.status, "pending"),
      ),
    );

  const in14Days = new Date(now);
  in14Days.setDate(in14Days.getDate() + 14);

  const consentDueContacts = await db
    .select({ name: contactsTable.name })
    .from(contactsTable)
    .where(
      and(
        eq(contactsTable.household_id, householdId),
        eq(contactsTable.consent_status, "consented"),
        gte(contactsTable.consent_check_in_due_at, now),
        lte(contactsTable.consent_check_in_due_at, in14Days),
      ),
    );

  const [onboardingState] = await db
    .select({ whatsapp_verified: onboardingStateTable.whatsapp_verified })
    .from(onboardingStateTable)
    .where(eq(onboardingStateTable.household_id, householdId))
    .limit(1);

  if (!onboardingState?.whatsapp_verified) {
    await db
      .update(householdsTable)
      .set({ last_briefing_sent_at: claimed[0].prev ?? null })
      .where(eq(householdsTable.id, householdId));
    return { ok: false, reason: "not_verified" };
  }

  let adminPhone: string | null = await resolveHouseholdAdminPhone(householdId);
  if (!adminPhone && fallbackPhone) {
    adminPhone = fallbackPhone;
  }

  if (!adminPhone) {
    await db
      .update(householdsTable)
      .set({ last_briefing_sent_at: claimed[0].prev ?? null })
      .where(eq(householdsTable.id, householdId));
    return { ok: false, reason: "no_phone" };
  }

  const dateStr = now.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const lines: string[] = [`🏡 *Resumo do dia — ${dateStr}*`, ""];

  if (events.length > 0) {
    lines.push("📅 *Agenda de hoje:*");
    for (const ev of events) {
      const timeStr = ev.all_day
        ? "dia todo"
        : new Date(ev.start_at).toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          });
      lines.push(`• ${ev.title} (${timeStr})`);
    }
    lines.push("");
  } else {
    lines.push("📅 Nenhum evento hoje.");
    lines.push("");
  }

  if (tasks.length > 0) {
    const shown = tasks.slice(0, 5);
    lines.push(`✅ *Tarefas pendentes (${tasks.length}):*`);
    for (const t of shown) {
      lines.push(`• ${t.title}`);
    }
    if (tasks.length > 5) {
      lines.push(`…e mais ${tasks.length - 5} tarefa(s).`);
    }
  } else {
    lines.push("✅ Nenhuma tarefa pendente.");
  }

  if (consentDueContacts.length > 0) {
    lines.push("");
    lines.push("⚠️ *Renovação de consentimento (LGPD):*");
    for (const c of consentDueContacts) {
      lines.push(`• ${c.name} — consentimento vence em breve`);
    }
    lines.push("_Acesse Casa → Privacidade para renovar._");
  }

  lines.push("");
  lines.push("_Enviado pelo Vesta — seu assistente familiar._");

  const message = lines.join("\n");
  const result = await sendWhatsApp(adminPhone, message);

  if (!result.ok) {
    // Revert the cooldown claim so last_briefing_sent_at reflects the last
    // *successful* delivery rather than a failed attempt.
    await db
      .update(householdsTable)
      .set({ last_briefing_sent_at: claimed[0].prev ?? null })
      .where(eq(householdsTable.id, householdId));
    logger.warn({ householdId, error: result.error }, "Briefing send failed");
    return { ok: false, reason: "send_failed", error: result.error };
  }

  logger.info({ householdId, sid: result.sid, adminPhone }, "Daily briefing sent");
  return { ok: true, sid: result.sid, eventsCount: events.length, tasksCount: tasks.length };
}
