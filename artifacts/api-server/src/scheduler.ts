import { db } from "@workspace/db";
import { householdsTable, onboardingStateTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./lib/logger";
import { sendHouseholdBriefing } from "./lib/briefing-core";

const TICK_INTERVAL_MS = 60_000;

let intervalHandle: ReturnType<typeof setInterval> | null = null;

async function tick(): Promise<void> {
  const currentHour = new Date().getUTCHours();

  try {
    const allVerified = await db
      .select({ id: householdsTable.id, briefing_hour: householdsTable.briefing_hour })
      .from(householdsTable)
      .innerJoin(
        onboardingStateTable,
        eq(onboardingStateTable.household_id, householdsTable.id),
      )
      .where(eq(onboardingStateTable.whatsapp_verified, true));

    const dueHouseholds = allVerified.filter((h) => h.briefing_hour === currentHour);

    if (dueHouseholds.length === 0) {
      return;
    }

    logger.info(
      { currentHour, count: dueHouseholds.length },
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

export function startScheduler(): void {
  if (intervalHandle !== null) {
    return;
  }
  intervalHandle = setInterval(() => {
    void tick();
  }, TICK_INTERVAL_MS);
  logger.info({ intervalMs: TICK_INTERVAL_MS }, "Briefing scheduler started");
}

export function stopScheduler(): void {
  if (intervalHandle !== null) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    logger.info("Briefing scheduler stopped");
  }
}
