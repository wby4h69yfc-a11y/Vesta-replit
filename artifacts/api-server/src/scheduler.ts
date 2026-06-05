import { db } from "@workspace/db";
import { householdsTable, onboardingStateTable } from "@workspace/db";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { logger } from "./lib/logger";
import { sendHouseholdBriefing } from "./lib/briefing-core";
import { detectPatternsForAllHouseholds } from "./lib/pattern-detector";
import { runConsentRenewalJob } from "./lib/consent-renewal-scheduler";
import { expireOldConversations } from "./lib/wa-prompt-store";
import {
  scheduleProactiveForAllHouseholds,
  sendDueProactiveMessages,
} from "./lib/proactive-scheduler";

const TICK_INTERVAL_MS = 60_000;
const PATTERN_INTERVAL_MS = 6 * 60 * 60 * 1000;
const CONSENT_RENEWAL_INTERVAL_MS = 24 * 60 * 60 * 1000;
const WA_CONV_EXPIRY_INTERVAL_MS = 15 * 60 * 1000;
const PROACTIVE_SCHEDULE_INTERVAL_MS = 24 * 60 * 60 * 1000; // once daily
const PROACTIVE_SEND_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes

let briefingIntervalHandle: ReturnType<typeof setInterval> | null = null;
let patternIntervalHandle: ReturnType<typeof setInterval> | null = null;
let consentRenewalIntervalHandle: ReturnType<typeof setInterval> | null = null;
let waConvExpiryIntervalHandle: ReturnType<typeof setInterval> | null = null;
let proactiveScheduleIntervalHandle: ReturnType<typeof setInterval> | null = null;
let proactiveSendIntervalHandle: ReturnType<typeof setInterval> | null = null;

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

    const currentUTCHour = now.getUTCHours();
    const dueHouseholds = allVerified.filter((h) => {
      return h.briefing_hour === currentUTCHour;
    });

    if (dueHouseholds.length === 0) {
      return;
    }

    logger.info(
      { utcHour: now.getUTCHours(), count: dueHouseholds.length },
      "Scheduler: dispatching briefings",
    );

    for (const household of dueHouseholds) {
      try {
        const result = await sendHouseholdBriefing(household.id);
        if (result.ok) {
          logger.info(
            { householdId: household.id, sid: result.sid },
            "Scheduler: briefing sent",
          );
        } else if (result.reason === "cooldown") {
          logger.debug(
            { householdId: household.id, retryAfterSec: result.retryAfterSec },
            "Scheduler: briefing skipped (cooldown)",
          );
        } else {
          logger.warn(
            { householdId: household.id, reason: result.reason },
            "Scheduler: briefing skipped",
          );
        }
      } catch (err) {
        logger.error({ err, householdId: household.id }, "Scheduler: briefing error");
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
}
