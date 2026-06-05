/**
 * ProactiveScheduler
 *
 * Builds and sends proactive WhatsApp messages per §20.2:
 *   - Daily digest (default 07h00 BRT)
 *   - Weekly look-ahead (Sunday 19h–20h BRT)
 *   - Calendar conflict detection (next 7 days)
 *
 * Rate limits:
 *   - Max 3 proactive messages per household per day
 *   - Quiet hours 21h–07h household local time → hold until 07h00
 *   - Suppress if ≥ 2 unread proactive messages pending engagement
 *   - PAUSAR / PARAR commands are respected (checked on households row)
 *
 * Durability:
 *   - `proactive_message_queue` is the source of truth
 *   - `sendDueProactiveMessages` retries up to 3× with exponential back-off
 *   - Multiple server instances safe: status transition uses atomic UPDATE WHERE
 */

import { db } from "@workspace/db";
import {
  householdsTable,
  proactiveMessageQueueTable,
  calendarEventsTable,
  tasksTable,
  onboardingStateTable,
} from "@workspace/db";
import { and, eq, gte, lte, lt, sql, count, isNull, or, ne } from "drizzle-orm";
import { sendWhatsApp, resolveHouseholdAdminPhone } from "./whatsapp";
import { logger } from "./logger";

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_PROACTIVE_PER_DAY = 3;
const MAX_UNREAD_PROACTIVE = 2;
const MAX_RETRY_COUNT = 3;
const QUIET_HOUR_START = 21; // 21h local
const QUIET_HOUR_END = 7;   // 07h local

// ── Local-time helpers ────────────────────────────────────────────────────────

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

function localDayOfWeek(date: Date, tz: string): number {
  try {
    const d = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      timeZone: tz,
    }).format(date);
    const days: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    return days[d] ?? date.getUTCDay();
  } catch {
    return date.getUTCDay();
  }
}

/**
 * Returns the next occurrence of `targetHour` (local time in `tz`) after `from`.
 * If the current local hour is before targetHour, returns today at targetHour;
 * otherwise tomorrow at targetHour.
 */
function nextLocalHourAfter(from: Date, targetHour: number, tz: string): Date {
  const currentLocal = localHour(from, tz);
  const candidate = new Date(from);
  if (currentLocal >= targetHour) {
    candidate.setDate(candidate.getDate() + 1);
  }
  // Set UTC such that the local hour equals targetHour — approximate by offset
  // We iterate UTC hours to find the one that maps to targetHour local.
  // This is accurate even for DST boundaries.
  for (let offset = 0; offset < 48; offset++) {
    const probe = new Date(candidate);
    probe.setUTCHours(0, 0, 0, 0);
    probe.setUTCHours(probe.getUTCHours() + offset);
    if (localHour(probe, tz) === targetHour && probe > from) {
      return probe;
    }
  }
  // Fallback: add UTC hours directly
  const fallback = new Date(from);
  fallback.setUTCHours(fallback.getUTCHours() + 1, 0, 0, 0);
  return fallback;
}

// ── Suppression checks ────────────────────────────────────────────────────────

/**
 * Returns the adjusted `scheduled_at` after applying quiet-hours enforcement.
 * If the scheduled time falls in 21h–07h local, pushes to next 07h00.
 */
function enforceQuietHours(scheduledAt: Date, tz: string): Date {
  const h = localHour(scheduledAt, tz);
  const inQuiet = h >= QUIET_HOUR_START || h < QUIET_HOUR_END;
  if (!inQuiet) return scheduledAt;
  return nextLocalHourAfter(scheduledAt, QUIET_HOUR_END, tz);
}

/**
 * Counts how many proactive messages were sent to this household today (local date).
 */
async function countSentToday(householdId: number, tz: string): Promise<number> {
  const now = new Date();
  // Compute start of today in the household's timezone by finding midnight UTC equivalent
  const todayLocalStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);
  // todayLocalStr is YYYY-MM-DD; parse into a UTC midnight for that local date
  const todayStart = new Date(`${todayLocalStr}T00:00:00`);
  // Adjust by timezone offset
  const offsetMs = now.getTime() - new Date(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(now)
      .replace(/(\d+)\/(\d+)\/(\d+),\s(\d+):(\d+):(\d+)/, "$3-$1-$2T$4:$5:$6")
  ).getTime();
  const localMidnight = new Date(todayStart.getTime() + offsetMs);

  const [row] = await db
    .select({ total: count() })
    .from(proactiveMessageQueueTable)
    .where(
      and(
        eq(proactiveMessageQueueTable.household_id, householdId),
        eq(proactiveMessageQueueTable.status, "sent"),
        gte(proactiveMessageQueueTable.sent_at, localMidnight),
      ),
    );
  return row?.total ?? 0;
}

/**
 * Returns true if there are ≥ 2 unread (sent but not replied/acted) proactive messages.
 */
async function hasUnreadBacklog(householdId: number): Promise<boolean> {
  const [row] = await db
    .select({ total: count() })
    .from(proactiveMessageQueueTable)
    .where(
      and(
        eq(proactiveMessageQueueTable.household_id, householdId),
        eq(proactiveMessageQueueTable.status, "sent"),
        eq(proactiveMessageQueueTable.user_replied, false),
        eq(proactiveMessageQueueTable.user_acted, false),
      ),
    );
  return (row?.total ?? 0) >= MAX_UNREAD_PROACTIVE;
}

/**
 * Returns true if a digest of the given trigger_type is already queued or sent
 * for today (to prevent duplicates from re-runs).
 */
async function alreadyScheduledToday(
  householdId: number,
  triggerType: string,
  tz: string,
): Promise<boolean> {
  const now = new Date();
  const todayLocalStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);
  const tomorrowStart = new Date(`${todayLocalStr}T23:59:59.999Z`);

  const [row] = await db
    .select({ total: count() })
    .from(proactiveMessageQueueTable)
    .where(
      and(
        eq(proactiveMessageQueueTable.household_id, householdId),
        eq(proactiveMessageQueueTable.trigger_type, triggerType),
        gte(proactiveMessageQueueTable.scheduled_at, new Date(`${todayLocalStr}T00:00:00Z`)),
        lte(proactiveMessageQueueTable.scheduled_at, tomorrowStart),
        or(
          eq(proactiveMessageQueueTable.status, "queued"),
          eq(proactiveMessageQueueTable.status, "sent"),
          eq(proactiveMessageQueueTable.status, "suppressed"),
        ),
      ),
    );
  return (row?.total ?? 0) > 0;
}

// ── Message builders ──────────────────────────────────────────────────────────

async function buildDailyDigestMessage(householdId: number, tz: string): Promise<{
  message: string;
  event_titles: string[];
  task_titles: string[];
}> {
  const now = new Date();
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);
  const todayStart = new Date(`${todayStr}T00:00:00Z`);
  const todayEnd = new Date(`${todayStr}T23:59:59.999Z`);

  const events = await db
    .select({ title: calendarEventsTable.title, start_at: calendarEventsTable.start_at, all_day: calendarEventsTable.all_day })
    .from(calendarEventsTable)
    .where(
      and(
        eq(calendarEventsTable.household_id, householdId),
        gte(calendarEventsTable.start_at, todayStart),
        lte(calendarEventsTable.start_at, todayEnd),
      ),
    );

  const tasks = await db
    .select({ title: tasksTable.title })
    .from(tasksTable)
    .where(
      and(
        eq(tasksTable.household_id, householdId),
        eq(tasksTable.status, "pending"),
      ),
    )
    .limit(5);

  const dateStr = now.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: tz,
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
            hour12: false,
            timeZone: tz,
          });
      lines.push(`• ${ev.title} (${timeStr})`);
    }
    lines.push("");
  } else {
    lines.push("📅 Nenhum evento hoje.", "");
  }

  if (tasks.length > 0) {
    lines.push(`✅ *Tarefas pendentes:*`);
    for (const t of tasks) lines.push(`• ${t.title}`);
  } else {
    lines.push("✅ Nenhuma tarefa pendente.");
  }

  lines.push("", "_Enviado pelo Vesta._");

  return {
    message: lines.join("\n"),
    event_titles: events.map((e) => e.title),
    task_titles: tasks.map((t) => t.title),
  };
}

async function buildWeeklyLookaheadMessage(householdId: number, tz: string): Promise<{
  message: string;
  event_titles: string[];
}> {
  const now = new Date();
  const in7Days = new Date(now);
  in7Days.setDate(in7Days.getDate() + 7);

  const events = await db
    .select({
      title: calendarEventsTable.title,
      start_at: calendarEventsTable.start_at,
      all_day: calendarEventsTable.all_day,
    })
    .from(calendarEventsTable)
    .where(
      and(
        eq(calendarEventsTable.household_id, householdId),
        gte(calendarEventsTable.start_at, now),
        lte(calendarEventsTable.start_at, in7Days),
      ),
    )
    .limit(10);

  const lines: string[] = ["📆 *Próximos 7 dias:*", ""];

  if (events.length > 0) {
    for (const ev of events) {
      const dayStr = new Date(ev.start_at).toLocaleDateString("pt-BR", {
        weekday: "short",
        day: "numeric",
        month: "short",
        timeZone: tz,
      });
      const timeStr = ev.all_day
        ? ""
        : ` às ${new Date(ev.start_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz })}`;
      lines.push(`• ${ev.title} — ${dayStr}${timeStr}`);
    }
  } else {
    lines.push("Nenhum evento nos próximos 7 dias.");
  }

  lines.push("", "_Enviado pelo Vesta._");

  return { message: lines.join("\n"), event_titles: events.map((e) => e.title) };
}

// ── Conflict detection ────────────────────────────────────────────────────────

interface ConflictPair {
  a: { id: number; title: string; start_at: Date; end_at: Date | null };
  b: { id: number; title: string; start_at: Date; end_at: Date | null };
}

/**
 * Finds pairs of calendar events in the next 7 days that have overlapping
 * time windows. Only considers timed events (not all-day).
 *
 * Two events A and B overlap when: A.start < B.end AND B.start < A.end.
 * If end_at is null, we assume a 1-hour duration.
 */
async function detectConflicts(householdId: number): Promise<ConflictPair[]> {
  const now = new Date();
  const in7Days = new Date(now);
  in7Days.setDate(in7Days.getDate() + 7);

  const events = await db
    .select({
      id: calendarEventsTable.id,
      title: calendarEventsTable.title,
      start_at: calendarEventsTable.start_at,
      end_at: calendarEventsTable.end_at,
      all_day: calendarEventsTable.all_day,
    })
    .from(calendarEventsTable)
    .where(
      and(
        eq(calendarEventsTable.household_id, householdId),
        eq(calendarEventsTable.all_day, false),
        gte(calendarEventsTable.start_at, now),
        lte(calendarEventsTable.start_at, in7Days),
      ),
    )
    .orderBy(calendarEventsTable.start_at);

  const conflicts: ConflictPair[] = [];
  const HOUR_MS = 60 * 60 * 1000;

  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const a = events[i]!;
      const b = events[j]!;
      const aEnd = a.end_at ?? new Date(a.start_at.getTime() + HOUR_MS);
      const bEnd = b.end_at ?? new Date(b.start_at.getTime() + HOUR_MS);
      // Overlap condition: a.start < b.end AND b.start < a.end
      if (a.start_at < bEnd && b.start_at < aEnd) {
        conflicts.push({
          a: { ...a, end_at: a.end_at },
          b: { ...b, end_at: b.end_at },
        });
      }
    }
  }

  return conflicts;
}

/**
 * Checks if a conflict_detected message for this specific event pair has
 * already been queued or sent (deduplication key: min(a.id, b.id)-max(a.id, b.id)).
 */
async function conflictAlreadyQueued(
  householdId: number,
  aId: number,
  bId: number,
): Promise<boolean> {
  const sourceId = Math.min(aId, bId);
  const [row] = await db
    .select({ total: count() })
    .from(proactiveMessageQueueTable)
    .where(
      and(
        eq(proactiveMessageQueueTable.household_id, householdId),
        eq(proactiveMessageQueueTable.trigger_type, "conflict_detected"),
        eq(proactiveMessageQueueTable.trigger_source_id, sourceId),
        or(
          eq(proactiveMessageQueueTable.status, "queued"),
          eq(proactiveMessageQueueTable.status, "sent"),
        ),
      ),
    );
  return (row?.total ?? 0) > 0;
}

// ── Main scheduling function ──────────────────────────────────────────────────

/**
 * Enqueues proactive messages for a single household.
 * Called once daily per household (around midnight local time).
 */
export async function scheduleProactiveMessages(householdId: number): Promise<void> {
  const [household] = await db
    .select({
      id: householdsTable.id,
      timezone: householdsTable.timezone,
      briefing_hour: householdsTable.briefing_hour,
      digest_enabled: householdsTable.digest_enabled,
      digest_stopped: householdsTable.digest_stopped,
      digest_paused_until: householdsTable.digest_paused_until,
    })
    .from(householdsTable)
    .where(eq(householdsTable.id, householdId))
    .limit(1);

  if (!household) return;

  const tz = household.timezone ?? "America/Sao_Paulo";
  const now = new Date();

  // ── 1. Daily digest ─────────────────────────────────────────────────────────
  if (
    household.digest_enabled &&
    !household.digest_stopped &&
    !(household.digest_paused_until && household.digest_paused_until > now)
  ) {
    const alreadyQueued = await alreadyScheduledToday(householdId, "daily_digest", tz);

    if (!alreadyQueued) {
      // Compute next occurrence of briefing_hour in local time
      const targetHour = localHour(
        new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), household.briefing_hour, 0, 0)),
        tz,
      );

      let scheduledAt = nextLocalHourAfter(now, targetHour, tz);
      scheduledAt = enforceQuietHours(scheduledAt, tz);

      // ── Sunday evening: weekly look-ahead instead of digest ────────────────
      const dayOfWeek = localDayOfWeek(scheduledAt, tz);
      const hour = localHour(scheduledAt, tz);
      const isSundayEvening = dayOfWeek === 0 && hour >= 19 && hour < 20;

      if (isSundayEvening) {
        const alreadyWeekly = await alreadyScheduledToday(householdId, "weekly_lookahead", tz);
        if (!alreadyWeekly) {
          const { message, event_titles } = await buildWeeklyLookaheadMessage(householdId, tz);
          await db.insert(proactiveMessageQueueTable).values({
            household_id: householdId,
            trigger_type: "weekly_lookahead",
            payload: { message, event_titles },
            scheduled_at: scheduledAt,
            status: "queued",
          });
          logger.info({ householdId, scheduledAt }, "Proactive: weekly look-ahead enqueued");
        }
      } else {
        const { message, event_titles, task_titles } = await buildDailyDigestMessage(
          householdId,
          tz,
        );
        await db.insert(proactiveMessageQueueTable).values({
          household_id: householdId,
          trigger_type: "daily_digest",
          payload: { message, event_titles, task_titles },
          scheduled_at: scheduledAt,
          status: "queued",
        });
        logger.info({ householdId, scheduledAt }, "Proactive: daily digest enqueued");
      }
    }
  }

  // ── 2. Conflict detection ───────────────────────────────────────────────────
  const conflicts = await detectConflicts(householdId);
  for (const { a, b } of conflicts) {
    const alreadyQueued = await conflictAlreadyQueued(householdId, a.id, b.id);
    if (alreadyQueued) continue;

    const aTime = new Date(a.start_at).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: tz,
    });
    const aDay = new Date(a.start_at).toLocaleDateString("pt-BR", {
      weekday: "long",
      timeZone: tz,
    });
    const message =
      `⚠️ *Conflito de agenda:*\n\n` +
      `*${a.title}* e *${b.title}* têm horários sobrepostos ${aDay} às ${aTime}.\n\n` +
      `_Acesse Agenda para resolver._`;

    let scheduledAt = enforceQuietHours(now, tz);

    await db.insert(proactiveMessageQueueTable).values({
      household_id: householdId,
      trigger_type: "conflict_detected",
      trigger_source_id: Math.min(a.id, b.id),
      payload: {
        message,
        conflict_pair: [a.title, b.title],
      },
      scheduled_at: scheduledAt,
      status: "queued",
    });
    logger.info(
      { householdId, eventA: a.title, eventB: b.title },
      "Proactive: conflict detected and enqueued",
    );
  }
}

// ── Sending tick ──────────────────────────────────────────────────────────────

/**
 * Processes all queued proactive messages whose scheduled_at <= now().
 * Atomically claims each row before sending to prevent double-sends across
 * multiple server instances.
 */
export async function sendDueProactiveMessages(): Promise<void> {
  const now = new Date();

  // Fetch rows eligible for processing (not yet claimed by another instance)
  const due = await db
    .select()
    .from(proactiveMessageQueueTable)
    .where(
      and(
        eq(proactiveMessageQueueTable.status, "queued"),
        lte(proactiveMessageQueueTable.scheduled_at, now),
        lt(proactiveMessageQueueTable.retry_count, MAX_RETRY_COUNT),
      ),
    )
    .limit(50);

  if (due.length === 0) return;

  for (const msg of due) {
    // Atomic claim: flip status to 'sending' or skip if already claimed
    const claimed = await db
      .update(proactiveMessageQueueTable)
      .set({ status: "suppressed" as const }) // temp value; see below
      .where(
        and(
          eq(proactiveMessageQueueTable.id, msg.id),
          eq(proactiveMessageQueueTable.status, "queued"),
        ),
      )
      .returning({ id: proactiveMessageQueueTable.id });

    if (claimed.length === 0) continue; // another instance got it

    // Restore queued status — we update to 'suppressed' only to claim; now
    // decide whether to actually send or suppress
    const [household] = await db
      .select({
        timezone: householdsTable.timezone,
        digest_enabled: householdsTable.digest_enabled,
        digest_stopped: householdsTable.digest_stopped,
        digest_paused_until: householdsTable.digest_paused_until,
      })
      .from(householdsTable)
      .where(eq(householdsTable.id, msg.household_id))
      .limit(1);

    if (!household) {
      await db
        .update(proactiveMessageQueueTable)
        .set({ status: "cancelled" })
        .where(eq(proactiveMessageQueueTable.id, msg.id));
      continue;
    }

    const tz = household.timezone ?? "America/Sao_Paulo";
    const isPaused =
      !household.digest_enabled ||
      household.digest_stopped ||
      (household.digest_paused_until != null && household.digest_paused_until > now);

    if (isPaused) {
      await db
        .update(proactiveMessageQueueTable)
        .set({ status: "suppressed" })
        .where(eq(proactiveMessageQueueTable.id, msg.id));
      logger.info({ msgId: msg.id, householdId: msg.household_id }, "Proactive: suppressed (paused/stopped)");
      continue;
    }

    // Rate limit: max 3 sent today
    const sentToday = await countSentToday(msg.household_id, tz);
    if (sentToday >= MAX_PROACTIVE_PER_DAY) {
      // Reschedule to tomorrow 07h00
      const nextSlot = nextLocalHourAfter(now, QUIET_HOUR_END, tz);
      await db
        .update(proactiveMessageQueueTable)
        .set({ status: "queued", scheduled_at: nextSlot })
        .where(eq(proactiveMessageQueueTable.id, msg.id));
      logger.info(
        { msgId: msg.id, householdId: msg.household_id, nextSlot },
        "Proactive: rate-limited — rescheduled to tomorrow",
      );
      continue;
    }

    // Unread backlog check
    const backlogged = await hasUnreadBacklog(msg.household_id);
    if (backlogged) {
      await db
        .update(proactiveMessageQueueTable)
        .set({ status: "suppressed" })
        .where(eq(proactiveMessageQueueTable.id, msg.id));
      logger.info({ msgId: msg.id, householdId: msg.household_id }, "Proactive: suppressed (unread backlog ≥ 2)");
      continue;
    }

    // Resolve destination
    const adminPhone = await resolveHouseholdAdminPhone(msg.household_id);
    if (!adminPhone) {
      await db
        .update(proactiveMessageQueueTable)
        .set({ status: "cancelled" })
        .where(eq(proactiveMessageQueueTable.id, msg.id));
      continue;
    }

    const messageBody = (msg.payload as { message?: string } | null)?.message;
    if (!messageBody) {
      await db
        .update(proactiveMessageQueueTable)
        .set({ status: "cancelled" })
        .where(eq(proactiveMessageQueueTable.id, msg.id));
      continue;
    }

    // Send
    const result = await sendWhatsApp(adminPhone, messageBody);
    if (result.ok) {
      await db
        .update(proactiveMessageQueueTable)
        .set({ status: "sent", sent_at: new Date() })
        .where(eq(proactiveMessageQueueTable.id, msg.id));
      logger.info({ msgId: msg.id, householdId: msg.household_id, sid: result.sid }, "Proactive: message sent");
    } else {
      const newRetry = (msg.retry_count ?? 0) + 1;
      const giveUp = newRetry >= MAX_RETRY_COUNT;
      // Exponential back-off: 5m, 20m, 80m
      const backoffMs = Math.pow(4, newRetry) * 5 * 60 * 1000;
      const retryAt = new Date(now.getTime() + backoffMs);

      await db
        .update(proactiveMessageQueueTable)
        .set({
          status: giveUp ? "failed" : "queued",
          retry_count: newRetry,
          scheduled_at: giveUp ? msg.scheduled_at : retryAt,
        })
        .where(eq(proactiveMessageQueueTable.id, msg.id));
      logger.warn(
        { msgId: msg.id, householdId: msg.household_id, retry: newRetry, giveUp },
        "Proactive: send failed",
      );
    }
  }
}

// ── Daily scheduler tick ──────────────────────────────────────────────────────

/**
 * Runs once per day per household (around midnight BRT) to enqueue next-day
 * proactive messages. Called from the scheduler.
 */
export async function scheduleProactiveForAllHouseholds(): Promise<void> {
  try {
    const verified = await db
      .select({ household_id: onboardingStateTable.household_id })
      .from(onboardingStateTable)
      .where(eq(onboardingStateTable.whatsapp_verified, true));

    logger.info({ count: verified.length }, "Proactive: scheduling messages for households");

    for (const row of verified) {
      try {
        await scheduleProactiveMessages(row.household_id);
      } catch (err) {
        logger.error({ err, householdId: row.household_id }, "Proactive: schedule error for household");
      }
    }
  } catch (err) {
    logger.error({ err }, "Proactive: scheduleProactiveForAllHouseholds error");
  }
}
