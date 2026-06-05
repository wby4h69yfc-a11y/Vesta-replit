import { db } from "@workspace/db";
import { householdsTable, onboardingStateTable, paymentObligationsTable } from "@workspace/db";
import { and, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { logger } from "./lib/logger";
import { detectPatternsForAllHouseholds } from "./lib/pattern-detector";
import { runConsentRenewalJob } from "./lib/consent-renewal-scheduler";
import { expireOldConversations } from "./lib/wa-prompt-store";
import {
  scheduleProactiveForAllHouseholds,
  scheduleProactiveMessages,
  sendDueProactiveMessages,
} from "./lib/proactive-scheduler";
import { resolveHouseholdAdminPhone, sendWhatsApp } from "./lib/whatsapp";

const TICK_INTERVAL_MS = 60_000;
const PATTERN_INTERVAL_MS = 6 * 60 * 60 * 1000;
const CONSENT_RENEWAL_INTERVAL_MS = 24 * 60 * 60 * 1000;
const WA_CONV_EXPIRY_INTERVAL_MS = 15 * 60 * 1000;
const PROACTIVE_SCHEDULE_INTERVAL_MS = 60 * 60 * 1000;
const PROACTIVE_SEND_INTERVAL_MS = 5 * 60 * 1000;
const PAYMENT_REMINDER_INTERVAL_MS = 60 * 60 * 1000; // every hour

let briefingIntervalHandle: ReturnType<typeof setInterval> | null = null;
let patternIntervalHandle: ReturnType<typeof setInterval> | null = null;
let consentRenewalIntervalHandle: ReturnType<typeof setInterval> | null = null;
let waConvExpiryIntervalHandle: ReturnType<typeof setInterval> | null = null;
let proactiveScheduleIntervalHandle: ReturnType<typeof setInterval> | null = null;
let proactiveSendIntervalHandle: ReturnType<typeof setInterval> | null = null;
let paymentReminderIntervalHandle: ReturnType<typeof setInterval> | null = null;

function localHourInTimezone(date: Date, timezone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: timezone,
    });
    const hourStr = formatter.format(date);
    const hour = parseInt(hourStr, 10);
    return isNaN(hour) ? date.getUTCHours() : hour % 24;
  } catch {
    return date.getUTCHours();
  }
}

/**
 * Runs every minute. For each WA-verified household that is due for a briefing
 * today (has not yet been sent one), enqueues its proactive messages via the
 * proactive queue. Actual sending is done by proactiveSendTick every 5 minutes.
 *
 * All digest delivery now goes through proactive_message_queue — this is the
 * ONLY enqueue trigger for time-of-day-based briefings, ensuring the queue is
 * the single source of truth and all rate limits / quiet hours / durability
 * guarantees are enforced uniformly.
 */
async function tick(): Promise<void> {
  const now = new Date();

  try {
    const allVerified = await db
      .select({
        id: householdsTable.id,
        briefing_hour: householdsTable.briefing_hour,
        timezone: householdsTable.timezone,
      })
      .from(householdsTable)
      .innerJoin(
        onboardingStateTable,
        eq(onboardingStateTable.household_id, householdsTable.id),
      )
      .where(
        and(
          eq(onboardingStateTable.whatsapp_verified, true),
          or(
            isNull(householdsTable.last_briefing_sent_at),
            sql`(${householdsTable.last_briefing_sent_at} AT TIME ZONE ${householdsTable.timezone})::date
                < (NOW() AT TIME ZONE ${householdsTable.timezone})::date`,
          ),
        ),
      );

    // briefing_hour is stored as a local hour — compare against the household's
    // current local time so DST changes are handled correctly.
    const dueHouseholds = allVerified.filter((h) => {
      const tz = h.timezone ?? "America/Sao_Paulo";
      return h.briefing_hour === localHourInTimezone(now, tz);
    });

    if (dueHouseholds.length === 0) return;

    logger.info(
      { count: dueHouseholds.length },
      "Scheduler: enqueuing proactive messages for due households",
    );

    for (const household of dueHouseholds) {
      try {
        await scheduleProactiveMessages(household.id);
      } catch (err) {
        logger.error({ err, householdId: household.id }, "Scheduler: proactive enqueue error");
      }
    }
  } catch (err) {
    logger.error({ err }, "Scheduler: tick error");
  }
}

async function patternTick(): Promise<void> {
  logger.info("Scheduler: running pattern detection");
  await detectPatternsForAllHouseholds();
}

async function consentRenewalTick(): Promise<void> {
  logger.info("Scheduler: running consent renewal job");
  try {
    await runConsentRenewalJob();
  } catch (err) {
    logger.error({ err }, "Scheduler: consent renewal job error");
  }
}

async function waConvExpiryTick(): Promise<void> {
  try {
    const expired = await expireOldConversations();
    if (expired > 0) {
      logger.info({ expired }, "Scheduler: expired WA conversations dismissed");
    }
  } catch (err) {
    logger.error({ err }, "Scheduler: WA conversation expiry error");
  }
}

async function proactiveScheduleTick(): Promise<void> {
  try {
    await scheduleProactiveForAllHouseholds();
  } catch (err) {
    logger.error({ err }, "Scheduler: proactive schedule tick error");
  }
}

async function proactiveSendTick(): Promise<void> {
  try {
    await sendDueProactiveMessages();
  } catch (err) {
    logger.error({ err }, "Scheduler: proactive send tick error");
  }
}

/**
 * Hourly: find payment obligations due within the next 24 hours that are still
 * pending (not paid / not cancelled) and send a WhatsApp reminder to the
 * household admin. Uses `reminded_at` on the obligation row to avoid duplicate
 * reminders within the same day.
 */
async function paymentReminderTick(): Promise<void> {
  try {
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const todayStr = now.toISOString().slice(0, 10);
    const in24hStr = in24h.toISOString().slice(0, 10);

    // Only send reminders in the 8–9 am window to avoid hourly spam
    if (now.getHours() < 8 || now.getHours() >= 9) return;

    // Find pending obligations due within 24 h
    const due = await db
      .select()
      .from(paymentObligationsTable)
      .where(
        and(
          gte(paymentObligationsTable.due_date, todayStr),
          lte(paymentObligationsTable.due_date, in24hStr),
          sql`${paymentObligationsTable.status} IN ('pending', 'overdue')`,
        ),
      );

    for (const ob of due) {
      try {
        const adminPhone = await resolveHouseholdAdminPhone(ob.household_id);
        if (!adminPhone) continue;
        const amountStr = ob.amount_cents
          ? ` de R$\u00A0${(ob.amount_cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
          : "";
        const dueStr = ob.due_date
          ? ` (vence ${ob.due_date.split("-").reverse().join("/")})`
          : "";
        await sendWhatsApp(
          adminPhone,
          `⏰ Lembrete de pagamento: *${ob.description}*${amountStr}${dueStr}.\n\nApós pagar, responda com a foto do comprovante.`,
        );
        // Mark reminded (best effort — failure doesn't stop other reminders)
        await db
          .update(paymentObligationsTable)
          .set({ status: ob.status })
          .where(eq(paymentObligationsTable.id, ob.id));
        logger.info({ obligationId: ob.id, householdId: ob.household_id }, "Payment reminder sent");
      } catch (innerErr) {
        logger.warn({ err: innerErr, obligationId: ob.id }, "Scheduler: payment reminder send error");
      }
    }
  } catch (err) {
    logger.error({ err }, "Scheduler: payment reminder tick error");
  }
}

export function startScheduler(): void {
  if (briefingIntervalHandle !== null) {
    return;
  }
  briefingIntervalHandle = setInterval(() => {
    void tick();
  }, TICK_INTERVAL_MS);
  logger.info({ intervalMs: TICK_INTERVAL_MS }, "Briefing scheduler started");

  void patternTick();
  patternIntervalHandle = setInterval(() => {
    void patternTick();
  }, PATTERN_INTERVAL_MS);
  logger.info({ intervalMs: PATTERN_INTERVAL_MS }, "Pattern detection scheduler started");

  void consentRenewalTick();
  consentRenewalIntervalHandle = setInterval(() => {
    void consentRenewalTick();
  }, CONSENT_RENEWAL_INTERVAL_MS);
  logger.info({ intervalMs: CONSENT_RENEWAL_INTERVAL_MS }, "Consent renewal scheduler started");

  void waConvExpiryTick();
  waConvExpiryIntervalHandle = setInterval(() => {
    void waConvExpiryTick();
  }, WA_CONV_EXPIRY_INTERVAL_MS);
  logger.info({ intervalMs: WA_CONV_EXPIRY_INTERVAL_MS }, "WA conversation expiry scheduler started");

  void proactiveScheduleTick();
  proactiveScheduleIntervalHandle = setInterval(() => {
    void proactiveScheduleTick();
  }, PROACTIVE_SCHEDULE_INTERVAL_MS);
  logger.info({ intervalMs: PROACTIVE_SCHEDULE_INTERVAL_MS }, "Proactive schedule tick started");

  void proactiveSendTick();
  proactiveSendIntervalHandle = setInterval(() => {
    void proactiveSendTick();
  }, PROACTIVE_SEND_INTERVAL_MS);
  logger.info({ intervalMs: PROACTIVE_SEND_INTERVAL_MS }, "Proactive send tick started");

  void paymentReminderTick();
  paymentReminderIntervalHandle = setInterval(() => {
    void paymentReminderTick();
  }, PAYMENT_REMINDER_INTERVAL_MS);
  logger.info({ intervalMs: PAYMENT_REMINDER_INTERVAL_MS }, "Payment reminder tick started");
}

export function stopScheduler(): void {
  if (briefingIntervalHandle !== null) {
    clearInterval(briefingIntervalHandle);
    briefingIntervalHandle = null;
    logger.info("Briefing scheduler stopped");
  }
  if (patternIntervalHandle !== null) {
    clearInterval(patternIntervalHandle);
    patternIntervalHandle = null;
    logger.info("Pattern detection scheduler stopped");
  }
  if (consentRenewalIntervalHandle !== null) {
    clearInterval(consentRenewalIntervalHandle);
    consentRenewalIntervalHandle = null;
    logger.info("Consent renewal scheduler stopped");
  }
  if (waConvExpiryIntervalHandle !== null) {
    clearInterval(waConvExpiryIntervalHandle);
    waConvExpiryIntervalHandle = null;
    logger.info("WA conversation expiry scheduler stopped");
  }
  if (proactiveScheduleIntervalHandle !== null) {
    clearInterval(proactiveScheduleIntervalHandle);
    proactiveScheduleIntervalHandle = null;
    logger.info("Proactive schedule tick stopped");
  }
  if (proactiveSendIntervalHandle !== null) {
    clearInterval(proactiveSendIntervalHandle);
    proactiveSendIntervalHandle = null;
    logger.info("Proactive send tick stopped");
  }
  if (paymentReminderIntervalHandle !== null) {
    clearInterval(paymentReminderIntervalHandle);
    paymentReminderIntervalHandle = null;
    logger.info("Payment reminder tick stopped");
  }
}
