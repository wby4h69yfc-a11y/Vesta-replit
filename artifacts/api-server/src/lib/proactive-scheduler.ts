/**
 * ProactiveScheduler
 *
 * Builds and sends proactive WhatsApp messages per §20.2:
 *   - Daily digest (default 07h00 BRT)
 *   - Weekly look-ahead (Sunday 19h–20h BRT)
 *   - Calendar conflict detection (next 7 days)
 *   - Payment-due alerts (tasks with due_at within 24h, financeiro category)
 *
 * Rate limits:
 *   - Max 3 proactive messages per household per day
 *   - Quiet hours 21h–07h household local time → hold until 07h00
 *   - Suppress if ≥ 2 unread proactive messages pending engagement
 *   - PAUSAR / PARAR commands are respected (checked on households row)
 *
 * Durability:
 *   - `proactive_message_queue` is the only sending path — no direct WA calls
 *   - Claim uses SELECT ... FOR UPDATE SKIP LOCKED so concurrent workers
 *     never double-send; crash recovery auto-requeues stale 'sending' rows
 *   - Quiet hours are re-enforced at send time (not just at enqueue time)
 *   - Conflict dedupe uses full pair key "minId-maxId" in template_name
 */

import { db, pool } from "@workspace/db";
import {
  householdsTable,
  proactiveMessageQueueTable,
  calendarEventsTable,
  tasksTable,
  onboardingStateTable,
  waConversationsTable,
} from "@workspace/db";
import { and, eq, gte, lte, lt, sql, count, or } from "drizzle-orm";
import { sendWhatsApp, resolveHouseholdAdminPhone } from "./whatsapp";
import { logger } from "./logger";

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_PROACTIVE_PER_DAY = 3;
const MAX_UNREAD_PROACTIVE = 2;
const MAX_RETRY_COUNT = 3;
const QUIET_HOUR_START = 21; // 21h local
const QUIET_HOUR_END = 7;   // 07h local
/** Rows stuck in 'sending' longer than this are auto-recovered (crash recovery). */
const SENDING_TIMEOUT_MINUTES = 10;

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
 * Returns the next occurrence of `targetHour` (local time in `tz`) that is
 * strictly after `from`. Iterates over UTC offsets to handle DST correctly.
 */
function nextLocalHourAfter(from: Date, targetHour: number, tz: string): Date {
  // Search up to 48 UTC-hour offsets to find the right moment
  for (let offset = 1; offset <= 48; offset++) {
    const probe = new Date(from.getTime() + offset * 60 * 60 * 1000);
    probe.setMinutes(0, 0, 0);
    if (localHour(probe, tz) === targetHour) {
      return probe;
    }
  }
  // Fallback: add 1 hour and truncate
  const fallback = new Date(from.getTime() + 60 * 60 * 1000);
  fallback.setMinutes(0, 0, 0);
  return fallback;
}

// ── Quiet hours ───────────────────────────────────────────────────────────────

/**
 * Returns true if `date` falls in the household's quiet window.
 * qStart defaults to QUIET_HOUR_START (21h), qEnd defaults to QUIET_HOUR_END (7h).
 */
function isInQuietHours(
  date: Date,
  tz: string,
  qStart: number = QUIET_HOUR_START,
  qEnd: number = QUIET_HOUR_END,
): boolean {
  const h = localHour(date, tz);
  // Handles overnight quiet window (e.g. 21h–07h) and daytime window (e.g. 10h–14h)
  if (qStart > qEnd) {
    return h >= qStart || h < qEnd;
  }
  return h >= qStart && h < qEnd;
}

/**
 * If `scheduledAt` falls in the household's quiet window, returns the next
 * occurrence of `qEnd` (quiet window end) local time. Otherwise unchanged.
 */
function enforceQuietHours(
  scheduledAt: Date,
  tz: string,
  qStart: number = QUIET_HOUR_START,
  qEnd: number = QUIET_HOUR_END,
): Date {
  if (!isInQuietHours(scheduledAt, tz, qStart, qEnd)) return scheduledAt;
  return nextLocalHourAfter(scheduledAt, qEnd, tz);
}

// ── Local-day boundary helper ─────────────────────────────────────────────────

/**
 * Returns [startUTC, endUTC] (end is exclusive) for the local calendar day
 * that `date` falls in when observed in the given IANA timezone.
 *
 * Uses the "noon offset" trick to avoid DST-transition ambiguity: DST changes
 * almost always happen at 02:00–03:00 local, so noon local is always
 * unambiguous.
 */
function localDayBounds(date: Date, tz: string): [Date, Date] {
  const localDateStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(date);
  const [year, month, day] = localDateStr.split("-").map(Number);

  const noonUTC = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const noonParts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  }).formatToParts(noonUTC);
  const localH = Number(noonParts.find(p => p.type === "hour")?.value ?? 12) % 24;
  const localM = Number(noonParts.find(p => p.type === "minute")?.value ?? 0);
  const localS = Number(noonParts.find(p => p.type === "second")?.value ?? 0);
  // offset: local = UTC + offsetSec → offsetSec = localNoon - 12:00:00
  const offsetSec = (localH - 12) * 3600 + localM * 60 + localS;

  const startMs = Date.UTC(year, month - 1, day, 0, 0, 0) - offsetSec * 1000;
  return [new Date(startMs), new Date(startMs + 86_400_000)];
}

// ── Suppression checks ────────────────────────────────────────────────────────

async function countSentToday(householdId: number, tz: string): Promise<number> {
  const [todayStart] = localDayBounds(new Date(), tz);

  const [row] = await db
    .select({ total: count() })
    .from(proactiveMessageQueueTable)
    .where(
      and(
        eq(proactiveMessageQueueTable.household_id, householdId),
        eq(proactiveMessageQueueTable.status, "sent"),
        gte(proactiveMessageQueueTable.sent_at, todayStart),
      ),
    );
  return row?.total ?? 0;
}

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
 * Dedup check by exact template_name key.
 * Used for daily_digest and weekly_lookahead where the key encodes the
 * delivery local-date, so restarts and duplicate ticks cannot enqueue a
 * second row for the same delivery day regardless of scheduled_at.
 */
async function alreadyScheduledByTemplateKey(
  householdId: number,
  templateName: string,
): Promise<boolean> {
  const [row] = await db
    .select({ total: count() })
    .from(proactiveMessageQueueTable)
    .where(
      and(
        eq(proactiveMessageQueueTable.household_id, householdId),
        eq(proactiveMessageQueueTable.template_name, templateName),
        or(
          eq(proactiveMessageQueueTable.status, "queued"),
          eq(proactiveMessageQueueTable.status, "sending"),
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
  const [todayStart, todayEnd] = localDayBounds(now, tz);

  const events = await db
    .select({ title: calendarEventsTable.title, start_at: calendarEventsTable.start_at, all_day: calendarEventsTable.all_day })
    .from(calendarEventsTable)
    .where(
      and(
        eq(calendarEventsTable.household_id, householdId),
        gte(calendarEventsTable.start_at, todayStart),
        lt(calendarEventsTable.start_at, todayEnd),
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
 * Finds pairs of calendar events in the next 7 days with overlapping windows.
 * Only considers timed events (not all-day).
 * A and B overlap when: A.start < B.end AND B.start < A.end.
 * Assumes 1-hour duration for events without end_at.
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
      if (a.start_at < bEnd && b.start_at < aEnd) {
        conflicts.push({ a: { ...a, end_at: a.end_at }, b: { ...b, end_at: b.end_at } });
      }
    }
  }

  return conflicts;
}

/**
 * Conflict dedup key: "conflict-{minId}-{maxId}" stored in template_name.
 * Using BOTH event IDs prevents false-positive dedup when two different pairs
 * share a lower-bound event ID (e.g. pair 1-2 vs pair 1-3).
 */
function conflictKey(aId: number, bId: number): string {
  return `conflict-${Math.min(aId, bId)}-${Math.max(aId, bId)}`;
}

async function conflictAlreadyQueued(
  householdId: number,
  aId: number,
  bId: number,
): Promise<boolean> {
  const key = conflictKey(aId, bId);
  const [row] = await db
    .select({ total: count() })
    .from(proactiveMessageQueueTable)
    .where(
      and(
        eq(proactiveMessageQueueTable.household_id, householdId),
        eq(proactiveMessageQueueTable.trigger_type, "conflict_detected"),
        eq(proactiveMessageQueueTable.template_name, key),
        or(
          eq(proactiveMessageQueueTable.status, "queued"),
          eq(proactiveMessageQueueTable.status, "sending"),
          eq(proactiveMessageQueueTable.status, "sent"),
        ),
      ),
    );
  return (row?.total ?? 0) > 0;
}

/**
 * Returns tasks with due_at within 24h that are pending and financial,
 * for which a payment_due alert hasn't been queued yet.
 */
async function getPaymentDueTasks(householdId: number): Promise<Array<{ id: number; title: string; due_at: Date }>> {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const dueTasks = await db
    .select({ id: tasksTable.id, title: tasksTable.title, due_at: tasksTable.due_at, category: tasksTable.category })
    .from(tasksTable)
    .where(
      and(
        eq(tasksTable.household_id, householdId),
        eq(tasksTable.status, "pending"),
        gte(tasksTable.due_at, now),
        lte(tasksTable.due_at, in24h),
      ),
    );

  // Filter to financial tasks and tasks already alerted
  const results: Array<{ id: number; title: string; due_at: Date }> = [];
  for (const task of dueTasks) {
    if (!task.due_at) continue;
    const isFinancial = task.category === "financeiro" ||
      /boleto|pagamento|conta|fatura/i.test(task.title);
    if (!isFinancial) continue;

    // Dedup: check if already queued for this task
    const [existing] = await db
      .select({ total: count() })
      .from(proactiveMessageQueueTable)
      .where(
        and(
          eq(proactiveMessageQueueTable.household_id, householdId),
          eq(proactiveMessageQueueTable.trigger_type, "payment_due"),
          eq(proactiveMessageQueueTable.trigger_source_id, task.id),
          or(
            eq(proactiveMessageQueueTable.status, "queued"),
            eq(proactiveMessageQueueTable.status, "sending"),
            eq(proactiveMessageQueueTable.status, "sent"),
          ),
        ),
      );
    if ((existing?.total ?? 0) === 0) {
      results.push({ id: task.id, title: task.title, due_at: task.due_at });
    }
  }
  return results;
}

// ── Main scheduling function ──────────────────────────────────────────────────

/**
 * Enqueues proactive messages for a single household.
 * Called from the scheduler tick to pre-build the queue for upcoming messages.
 * The actual sending is done by sendDueProactiveMessages().
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
      quiet_hour_start: householdsTable.quiet_hour_start,
      quiet_hour_end: householdsTable.quiet_hour_end,
    })
    .from(householdsTable)
    .where(eq(householdsTable.id, householdId))
    .limit(1);

  if (!household) return;

  const tz = household.timezone ?? "America/Sao_Paulo";
  const now = new Date();
  const qStart = household.quiet_hour_start ?? QUIET_HOUR_START;
  const qEnd = household.quiet_hour_end ?? QUIET_HOUR_END;

  // ── 1. Daily digest / weekly look-ahead ─────────────────────────────────────
  if (
    household.digest_enabled &&
    !household.digest_stopped &&
    !(household.digest_paused_until && household.digest_paused_until > now)
  ) {
    // briefing_hour is stored as a household-local hour (e.g., 7 = 07h00 local).
    // It is the digest time field for this product (hour granularity).
    const targetLocalHour = household.briefing_hour;

    const nowLocalDOW = localDayOfWeek(now, tz);
    const nowLocalHour = localHour(now, tz);
    const isSunday = nowLocalDOW === 0;

    if (isSunday) {
      // On Sundays, send the weekly look-ahead instead of the daily digest.
      // Dedup key encodes this Sunday's local date so duplicate ticks (or
      // restarts during the 19h hour) never insert a second row.
      const sundayDateStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);
      const weeklyTemplateKey = `weekly_lookahead_${sundayDateStr}`;
      const alreadyWeekly = await alreadyScheduledByTemplateKey(householdId, weeklyTemplateKey);
      if (!alreadyWeekly) {
        let scheduledAt: Date;
        if (nowLocalHour < 19) {
          // Still before the 19h window — pre-schedule for exactly 19h00 local.
          // Subtract 1ms so nextLocalHourAfter(now-1ms, 19) targets today.
          scheduledAt = nextLocalHourAfter(new Date(now.getTime() - 1), 19, tz);
        } else {
          // At or past 19h (including catch-up after a server gap) — send now.
          scheduledAt = enforceQuietHours(now, tz, qStart, qEnd);
        }
        const { message, event_titles } = await buildWeeklyLookaheadMessage(householdId, tz);
        await db.insert(proactiveMessageQueueTable).values({
          household_id: householdId,
          trigger_type: "weekly_lookahead",
          template_name: weeklyTemplateKey,
          payload: { message, event_titles },
          scheduled_at: scheduledAt,
          status: "queued",
        });
        logger.info({ householdId, scheduledAt, nowLocalHour }, "Proactive: weekly look-ahead enqueued");
      }
    } else {
      // Weekday: enqueue the daily digest at briefing_hour local.
      //
      // Scheduling semantics:
      //   nowLocalHour < target  → deliver TODAY at targetH (nextLocalHourAfter returns today)
      //   nowLocalHour === target → we are in the window; deliver NOW
      //   nowLocalHour > target  → missed today; deliver TOMORROW at targetH
      //
      // Dedup key encodes the delivery local date so repeated hourly ticks
      // (or restarts during the digest hour) cannot insert a second row.
      let scheduledAt: Date;
      if (nowLocalHour === targetLocalHour) {
        scheduledAt = enforceQuietHours(now, tz, qStart, qEnd);
      } else {
        scheduledAt = enforceQuietHours(nextLocalHourAfter(now, targetLocalHour, tz), tz, qStart, qEnd);
      }
      const deliveryDateStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(scheduledAt);
      const digestTemplateKey = `daily_digest_${deliveryDateStr}`;
      const alreadyQueued = await alreadyScheduledByTemplateKey(householdId, digestTemplateKey);
      if (!alreadyQueued) {
        const { message, event_titles, task_titles } = await buildDailyDigestMessage(householdId, tz);
        await db.insert(proactiveMessageQueueTable).values({
          household_id: householdId,
          trigger_type: "daily_digest",
          template_name: digestTemplateKey,
          payload: { message, event_titles, task_titles },
          scheduled_at: scheduledAt,
          status: "queued",
        });
        logger.info({ householdId, scheduledAt, deliveryDateStr }, "Proactive: daily digest enqueued");
      }
    }
  }

  // ── 2. Calendar conflict detection ──────────────────────────────────────────
  const conflicts = await detectConflicts(householdId);
  for (const { a, b } of conflicts) {
    if (await conflictAlreadyQueued(householdId, a.id, b.id)) continue;

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

    const scheduledAt = enforceQuietHours(now, tz, qStart, qEnd);
    await db.insert(proactiveMessageQueueTable).values({
      household_id: householdId,
      trigger_type: "conflict_detected",
      template_name: conflictKey(a.id, b.id),
      trigger_source_id: Math.min(a.id, b.id),
      payload: { message, conflict_pair: [a.title, b.title] },
      scheduled_at: scheduledAt,
      status: "queued",
    });
    logger.info({ householdId, eventA: a.title, eventB: b.title }, "Proactive: conflict enqueued");
  }

  // ── 3. Payment-due alerts ────────────────────────────────────────────────────
  const paymentTasks = await getPaymentDueTasks(householdId);
  for (const task of paymentTasks) {
    const dueTimeStr = task.due_at.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: tz,
    });
    const dueDateStr = task.due_at.toLocaleDateString("pt-BR", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: tz,
    });
    const message =
      `💰 *Pagamento próximo:*\n\n` +
      `*${task.title}* vence ${dueDateStr} às ${dueTimeStr}.\n\n` +
      `_Acesse Agenda para confirmar._`;

    const scheduledAt = enforceQuietHours(now, tz, qStart, qEnd);
    await db.insert(proactiveMessageQueueTable).values({
      household_id: householdId,
      trigger_type: "payment_due",
      trigger_source_id: task.id,
      payload: { message },
      scheduled_at: scheduledAt,
      status: "queued",
    });
    logger.info({ householdId, taskId: task.id, title: task.title }, "Proactive: payment_due enqueued");
  }
}

// ── Sending tick ──────────────────────────────────────────────────────────────

/**
 * Processes all queued proactive messages whose scheduled_at <= now().
 *
 * Multi-instance safety:
 *   Uses SELECT ... FOR UPDATE SKIP LOCKED to atomically claim rows without
 *   letting concurrent workers claim the same row. Claimed rows are immediately
 *   SET status='sending', scheduled_at=now()+10min so a crashed worker's rows
 *   are auto-recovered: the recovery step at the top resets any 'sending' rows
 *   whose scheduled_at is in the past (> 10 minutes after claim) back to 'queued'.
 *
 * Quiet hours are re-enforced at send time (in addition to enqueue time) to
 * handle rows enqueued during DST transitions or re-scheduled from yesterday.
 */
export async function sendDueProactiveMessages(): Promise<void> {
  const now = new Date();

  // ── Crash recovery: reset stale 'sending' rows ───────────────────────────
  // Rows stuck as 'sending' with scheduled_at in the past were claimed but
  // never resolved (server crash). Reset them to 'queued' with the original
  // scheduled_at (subtract the 10-minute offset we added during claim).
  await db.execute(sql`
    UPDATE proactive_message_queue
    SET status = 'queued',
        scheduled_at = scheduled_at - INTERVAL '${sql.raw(String(SENDING_TIMEOUT_MINUTES))} minutes'
    WHERE status = 'sending'
      AND scheduled_at < NOW()
  `);

  // ── Claim up to 10 rows atomically with SKIP LOCKED ──────────────────────
  const client = await pool.connect();
  let claimedRows: Array<Record<string, unknown>> = [];
  try {
    await client.query("BEGIN");
    const result = await client.query<Record<string, unknown>>(`
      UPDATE proactive_message_queue
      SET status = 'sending',
          scheduled_at = NOW() + INTERVAL '${SENDING_TIMEOUT_MINUTES} minutes'
      WHERE id IN (
        SELECT id FROM proactive_message_queue
        WHERE status = 'queued'
          AND scheduled_at <= NOW()
          AND retry_count < $1
        ORDER BY scheduled_at
        LIMIT 10
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `, [MAX_RETRY_COUNT]);
    await client.query("COMMIT");
    claimedRows = result.rows;
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error({ err }, "Proactive: failed to claim rows");
    return;
  } finally {
    client.release();
  }

  if (claimedRows.length === 0) return;
  logger.debug({ count: claimedRows.length }, "Proactive: claimed rows for sending");

  for (const row of claimedRows) {
    const msgId = row.id as number;
    const householdId = row.household_id as number;
    const originalScheduledAt = new Date(row.scheduled_at as string);
    // Restore original scheduled_at (we added SENDING_TIMEOUT_MINUTES during claim)
    const actualScheduledAt = new Date(originalScheduledAt.getTime() - SENDING_TIMEOUT_MINUTES * 60 * 1000);

    try {
      await processSingleMessage(msgId, householdId, actualScheduledAt, row);
    } catch (err) {
      logger.error({ err, msgId, householdId }, "Proactive: error processing message");
      // Reset to queued so it retries
      await db
        .update(proactiveMessageQueueTable)
        .set({ status: "queued", scheduled_at: actualScheduledAt })
        .where(eq(proactiveMessageQueueTable.id, msgId));
    }
  }
}

async function processSingleMessage(
  msgId: number,
  householdId: number,
  scheduledAt: Date,
  row: Record<string, unknown>,
): Promise<void> {
  const now = new Date();

  // Fetch household for suppression checks and per-household quiet hours
  const [household] = await db
    .select({
      timezone: householdsTable.timezone,
      digest_enabled: householdsTable.digest_enabled,
      digest_stopped: householdsTable.digest_stopped,
      digest_paused_until: householdsTable.digest_paused_until,
      quiet_hour_start: householdsTable.quiet_hour_start,
      quiet_hour_end: householdsTable.quiet_hour_end,
    })
    .from(householdsTable)
    .where(eq(householdsTable.id, householdId))
    .limit(1);

  if (!household) {
    await db.update(proactiveMessageQueueTable)
      .set({ status: "cancelled" })
      .where(eq(proactiveMessageQueueTable.id, msgId));
    return;
  }

  const tz = household.timezone ?? "America/Sao_Paulo";
  const qStart = household.quiet_hour_start ?? QUIET_HOUR_START;
  const qEnd = household.quiet_hour_end ?? QUIET_HOUR_END;

  // ── Suppressed (PAUSAR / PARAR) ───────────────────────────────────────────
  const isPaused =
    !household.digest_enabled ||
    household.digest_stopped ||
    (household.digest_paused_until != null && household.digest_paused_until > now);

  if (isPaused) {
    await db.update(proactiveMessageQueueTable)
      .set({ status: "suppressed" })
      .where(eq(proactiveMessageQueueTable.id, msgId));
    logger.info({ msgId, householdId }, "Proactive: suppressed (paused/stopped)");
    return;
  }

  // ── Re-enforce quiet hours at send time (per-household window) ────────────
  if (isInQuietHours(now, tz, qStart, qEnd)) {
    const nextSlot = enforceQuietHours(now, tz, qStart, qEnd);
    await db.update(proactiveMessageQueueTable)
      .set({ status: "queued", scheduled_at: nextSlot })
      .where(eq(proactiveMessageQueueTable.id, msgId));
    logger.info({ msgId, householdId, nextSlot, qStart, qEnd }, "Proactive: quiet hours — rescheduled");
    return;
  }

  // ── Rate limit ────────────────────────────────────────────────────────────
  const sentToday = await countSentToday(householdId, tz);
  if (sentToday >= MAX_PROACTIVE_PER_DAY) {
    const nextSlot = nextLocalHourAfter(now, qEnd, tz);
    await db.update(proactiveMessageQueueTable)
      .set({ status: "queued", scheduled_at: nextSlot })
      .where(eq(proactiveMessageQueueTable.id, msgId));
    logger.info({ msgId, householdId, nextSlot }, "Proactive: rate-limited — rescheduled tomorrow");
    return;
  }

  // ── Unread backlog ────────────────────────────────────────────────────────
  const backlogged = await hasUnreadBacklog(householdId);
  if (backlogged) {
    await db.update(proactiveMessageQueueTable)
      .set({ status: "suppressed" })
      .where(eq(proactiveMessageQueueTable.id, msgId));
    logger.info({ msgId, householdId }, "Proactive: suppressed (unread backlog ≥ 2)");
    return;
  }

  // ── Resolve destination ───────────────────────────────────────────────────
  const adminPhone = await resolveHouseholdAdminPhone(householdId);
  if (!adminPhone) {
    await db.update(proactiveMessageQueueTable)
      .set({ status: "cancelled" })
      .where(eq(proactiveMessageQueueTable.id, msgId));
    return;
  }

  const payload = row.payload as { message?: string } | null;
  const messageBody = payload?.message;
  if (!messageBody) {
    await db.update(proactiveMessageQueueTable)
      .set({ status: "cancelled" })
      .where(eq(proactiveMessageQueueTable.id, msgId));
    return;
  }

  // ── Send ──────────────────────────────────────────────────────────────────
  const result = await sendWhatsApp(adminPhone, messageBody);
  if (result.ok) {
    await db.update(proactiveMessageQueueTable)
      .set({ status: "sent", sent_at: new Date() })
      .where(eq(proactiveMessageQueueTable.id, msgId));

    // After sending a provider rating request, open a wa_conversations row so
    // the admin's reply is matched to the correct rating context.
    if (row.trigger_type === "provider_rating_request") {
      const ratingPayload = payload as { contact_id?: number; contact_name?: string } | null;
      if (ratingPayload?.contact_id) {
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await db.insert(waConversationsTable).values({
          household_id: householdId,
          sender_phone: adminPhone,
          state: "awaiting_confirmation",
          thread_context: "rating_request",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          proposed_payload: { contact_id: ratingPayload.contact_id, contact_name: ratingPayload.contact_name ?? "prestador" } as any,
          expires_at: expiresAt,
        });
        logger.info({ msgId, householdId, contactId: ratingPayload.contact_id }, "Proactive: opened rating_request wa_conversation");
      }
    }

    // Keep last_briefing_sent_at in sync for backward compatibility
    if (row.trigger_type === "daily_digest") {
      await db.update(householdsTable)
        .set({ last_briefing_sent_at: new Date() })
        .where(eq(householdsTable.id, householdId));
    }
    logger.info({ msgId, householdId, sid: result.sid, triggerType: row.trigger_type }, "Proactive: sent");
  } else {
    const retryCount = (row.retry_count as number ?? 0) + 1;
    const giveUp = retryCount >= MAX_RETRY_COUNT;
    const backoffMs = Math.pow(4, retryCount) * 5 * 60 * 1000; // 5m, 20m, 80m
    const retryAt = new Date(now.getTime() + backoffMs);

    await db.update(proactiveMessageQueueTable)
      .set({
        status: giveUp ? "failed" : "queued",
        retry_count: retryCount,
        scheduled_at: giveUp ? scheduledAt : retryAt,
      })
      .where(eq(proactiveMessageQueueTable.id, msgId));
    logger.warn({ msgId, householdId, retry: retryCount, giveUp }, "Proactive: send failed");
  }
}

// ── Batch scheduling ──────────────────────────────────────────────────────────

/**
 * Enqueues next proactive messages for all WA-verified households.
 * Called from the scheduler tick once daily (or more frequently — dedup
 * inside scheduleProactiveMessages prevents duplicates).
 */
export async function scheduleProactiveForAllHouseholds(): Promise<void> {
  try {
    const verified = await db
      .select({ household_id: onboardingStateTable.household_id })
      .from(onboardingStateTable)
      .where(eq(onboardingStateTable.whatsapp_verified, true));

    logger.info({ count: verified.length }, "Proactive: scheduling for all households");

    for (const row of verified) {
      try {
        await scheduleProactiveMessages(row.household_id);
      } catch (err) {
        logger.error({ err, householdId: row.household_id }, "Proactive: schedule error");
      }
    }
  } catch (err) {
    logger.error({ err }, "Proactive: scheduleProactiveForAllHouseholds error");
  }
}
