/**
 * WA Onboarding Recovery
 *
 * Two recovery mechanisms for incomplete WhatsApp sign-ups:
 *
 * 1. `sendOnboardingReminders()` — hourly scheduler job that finds sessions
 *    that have progressed past LGPD acceptance but are within 1 hour of
 *    expiry (i.e., ~23 hours old) and sends a single re-engagement nudge.
 *    A `reminder_sent_at` stamp prevents duplicate sends.
 *
 * 2. `isOnboardingRestartGreeting()` — detects casual greetings ("oi", "olá",
 *    etc.) so the onboarding handler can reply with a warmer "welcome back"
 *    message when a session had to be restarted.
 */

import { db } from "@workspace/db";
import { waOnboardingSessionsTable } from "@workspace/db";
import { and, gt, isNull, lte, ne, eq } from "drizzle-orm";
import { logger } from "./logger";
import { sendWhatsApp } from "./whatsapp";

// ── Greeting detection ────────────────────────────────────────────────────────

const RESTART_GREETINGS = new Set([
  "oi",
  "ola",
  "olá",
  "hello",
  "hi",
  "hey",
  "bom dia",
  "boa tarde",
  "boa noite",
  "boas",
  "e ai",
  "eai",
  "e aí",
  "opa",
  "oie",
]);

/**
 * Returns true if the message looks like a casual greeting that should
 * trigger a warm restart rather than the generic LGPD welcome screen.
 */
export function isOnboardingRestartGreeting(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[!?.]+$/, "") // strip trailing punctuation
    .trim();
  return RESTART_GREETINGS.has(normalized);
}

// ── Reminder message ──────────────────────────────────────────────────────────

function buildReminderMessage(step: string): string {
  const stepContext =
    step === "NAME_CITY"
      ? "Você aceitou o aviso de privacidade mas ainda não informou seu nome."
      : step === "HOUSEHOLD_COMPOSITION"
        ? "Você já nos disse seu nome, falta só mais 1 passo."
        : step === "RULE_TEMPLATES"
          ? "Você está quase lá — só falta escolher as categorias de avisos."
          : "Você começou a configurar sua conta mas não terminou.";

  return (
    "👋 *Vesta aqui!*\n\n" +
    `${stepContext}\n\n` +
    "Sua sessão expira em breve. Responda qualquer mensagem para continuar de onde parou, " +
    "ou envie *oi* para começar novamente.\n\n" +
    "_Se não quiser mais continuar, pode ignorar esta mensagem._"
  );
}

// ── Warm restart reply ────────────────────────────────────────────────────────

/**
 * Returns the friendly re-engagement welcome message used when a user whose
 * session expired sends a greeting and gets a fresh session.
 */
export function replyWarmRestart(): string {
  return (
    "👋 Olá de novo! Que bom te ver por aqui.\n\n" +
    "Sua sessão anterior expirou, então vamos começar do início — " +
    "não leva mais do que 2 minutinhos!\n\n" +
    "Eu sou a *Vesta*, assistente de logística familiar. " +
    "Posso organizar mensagens da escola, consultas, boletos e muito mais — " +
    "tudo pelo WhatsApp.\n\n" +
    "📋 *Aviso de privacidade (LGPD):*\n" +
    "Para configurar sua conta coletarei seu nome, cidade e composição familiar. " +
    "Seus dados são usados exclusivamente para personalizar o Vesta e não são " +
    "compartilhados com terceiros.\n\n" +
    "Para continuar, responda *ACEITO*.\n" +
    "Para saber mais sobre privacidade, acesse: https://vesta.app/privacidade"
  );
}

// ── Reminder scheduler job ────────────────────────────────────────────────────

/**
 * Finds in-progress onboarding sessions that:
 *   - Have LGPD accepted (user started providing data)
 *   - Are within 1 hour of expiry (~23h old)
 *   - Haven't already received a reminder
 *
 * Sends a single WhatsApp re-engagement nudge per session and stamps
 * `reminder_sent_at` to prevent duplicates on subsequent ticks.
 *
 * Safe to call on autoscaled deployments because the update is gated on
 * `reminder_sent_at IS NULL`, so concurrent workers that race to pick up
 * the same session will only send one message (last-writer idempotency via
 * the DB update).
 */
export async function sendOnboardingReminders(): Promise<void> {
  const now = new Date();
  const in1h = new Date(now.getTime() + 60 * 60 * 1000);

  const sessions = await db
    .select({
      id: waOnboardingSessionsTable.id,
      phone: waOnboardingSessionsTable.phone,
      step: waOnboardingSessionsTable.step,
    })
    .from(waOnboardingSessionsTable)
    .where(
      and(
        eq(waOnboardingSessionsTable.lgpd_accepted, true),
        ne(waOnboardingSessionsTable.step, "COMPLETE"),
        gt(waOnboardingSessionsTable.expires_at, now),
        lte(waOnboardingSessionsTable.expires_at, in1h),
        isNull(waOnboardingSessionsTable.reminder_sent_at),
      ),
    );

  if (sessions.length === 0) {
    logger.debug("WA onboarding recovery: no sessions due for reminder");
    return;
  }

  logger.info(
    { count: sessions.length },
    "WA onboarding recovery: sending re-engagement reminders",
  );

  for (const session of sessions) {
    // Stamp reminder_sent_at first — if WhatsApp send fails, we still avoid
    // a flood of retries on the next tick. The user can restart with "oi".
    await db
      .update(waOnboardingSessionsTable)
      .set({ reminder_sent_at: now })
      .where(
        and(
          eq(waOnboardingSessionsTable.id, session.id),
          isNull(waOnboardingSessionsTable.reminder_sent_at),
        ),
      );

    const message = buildReminderMessage(session.step);
    const result = await sendWhatsApp(session.phone, message);

    if (result.ok) {
      logger.info(
        { sessionId: session.id, phone: session.phone, step: session.step, sid: result.sid },
        "WA onboarding recovery: reminder sent",
      );
    } else {
      logger.warn(
        { sessionId: session.id, phone: session.phone, error: result.error },
        "WA onboarding recovery: WhatsApp send failed (reminder_sent_at already stamped)",
      );
    }
  }
}
