import { db } from "@workspace/db";
import { householdsTable, onboardingStateTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./lib/logger";
import { sendHouseholdBriefing } from "./lib/briefing-core";
import { detectPatternsForAllHouseholds } from "./lib/pattern-detector";

const TICK_INTERVAL_MS = 60_000;
const PATTERN_INTERVAL_MS = 6 * 60 * 60 * 1000;

let briefingIntervalHandle: ReturnType<typeof setInterval> | null = null;
let patternIntervalHandle: ReturnType<typeof setInterval> | null = null;

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
      .where(eq(onboardingStateTable.whatsapp_verified, true));

    const dueHouseholds = allVerified.filter((h) => {
      const localHour = localHourInTimezone(now, h.timezone ?? "America/Sao_Paulo");
      return h.briefing_hour === localHour;
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
}
