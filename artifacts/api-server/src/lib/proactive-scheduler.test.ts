/**
 * Unit tests for the inbox-nudge helpers in proactive-scheduler.
 *
 * Tests cover pure functions only — no database or network calls.
 *
 * Run with:  pnpm --filter @workspace/api-server run test:unit
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildInboxNudgeMessage,
  shouldSendInboxNudge,
  buildInboxNudgeQueueEntry,
  INBOX_NUDGE_THRESHOLD_HOURS,
  INBOX_NUDGE_COOLDOWN_HOURS,
  type InboxNudgeContext,
  type InboxNudgeEnqueueParams,
} from "./proactive-scheduler.js";

// ── buildInboxNudgeMessage ─────────────────────────────────────────────────────

describe("buildInboxNudgeMessage", () => {
  test("singular form when count is 1", () => {
    const msg = buildInboxNudgeMessage(1);
    assert.ok(msg.includes("1 mensagem aguardando revisão"), msg);
    assert.ok(!msg.includes("mensagens"), msg);
  });

  test("plural form when count is 2", () => {
    const msg = buildInboxNudgeMessage(2);
    assert.ok(msg.includes("2 mensagens aguardando revisão"), msg);
  });

  test("plural form when count is 10", () => {
    const msg = buildInboxNudgeMessage(10);
    assert.ok(msg.includes("10 mensagens aguardando revisão"), msg);
  });

  test("message contains CTA to open Vesta", () => {
    const msg = buildInboxNudgeMessage(3);
    assert.ok(msg.includes("Abra o Vesta para revisar"), msg);
  });

  test("message includes Caixa de entrada reference", () => {
    const msg = buildInboxNudgeMessage(1);
    assert.ok(msg.includes("Caixa de entrada"), msg);
  });

  test("message does not expose raw message content (privacy guard)", () => {
    const msg = buildInboxNudgeMessage(5);
    assert.ok(!msg.includes("conteúdo"), msg);
  });

  test("constants are at documented values", () => {
    assert.equal(INBOX_NUDGE_THRESHOLD_HOURS, 4);
    assert.equal(INBOX_NUDGE_COOLDOWN_HOURS, 24);
  });
});

// ── shouldSendInboxNudge ──────────────────────────────────────────────────────

const NOW = new Date("2026-06-09T14:00:00Z");

/** A stale item updated 5h before NOW — older than the 4h threshold */
const STALE_ITEM_AT = new Date(NOW.getTime() - 5 * 60 * 60 * 1000);

function baseCtx(overrides: Partial<InboxNudgeContext> = {}): InboxNudgeContext {
  return {
    staleCount: 3,
    earliestStaleItemUpdatedAt: STALE_ITEM_AT,
    lastNudgeSentAt: null,
    isDigestStopped: false,
    isDigestPaused: false,
    now: NOW,
    ...overrides,
  };
}

describe("shouldSendInboxNudge", () => {
  // ── staleCount = 0 ───────────────────────────────────────────────────────────

  test("returns false when no stale items (count = 0)", () => {
    assert.equal(
      shouldSendInboxNudge(baseCtx({ staleCount: 0, earliestStaleItemUpdatedAt: null })),
      false,
    );
  });

  // ── digest suppressed ────────────────────────────────────────────────────────

  test("returns false when digest_stopped is true", () => {
    assert.equal(shouldSendInboxNudge(baseCtx({ isDigestStopped: true })), false);
  });

  test("returns false when digest is paused", () => {
    assert.equal(shouldSendInboxNudge(baseCtx({ isDigestPaused: true })), false);
  });

  test("returns false when both digest_stopped and paused", () => {
    assert.equal(
      shouldSendInboxNudge(baseCtx({ isDigestStopped: true, isDigestPaused: true })),
      false,
    );
  });

  // ── cooldown active, same batch ──────────────────────────────────────────────

  test("returns false: last nudge 1h ago, stale item predates nudge (same batch)", () => {
    const oneHourAgo = new Date(NOW.getTime() - 1 * 60 * 60 * 1000);
    const staleBefore = new Date(NOW.getTime() - 5 * 60 * 60 * 1000);
    assert.equal(
      shouldSendInboxNudge(
        baseCtx({ lastNudgeSentAt: oneHourAgo, earliestStaleItemUpdatedAt: staleBefore }),
      ),
      false,
    );
  });

  test("returns false: cooldown boundary (23h59m ago), same batch", () => {
    const nearlyExpired = new Date(
      NOW.getTime() - (INBOX_NUDGE_COOLDOWN_HOURS * 60 * 60 * 1000 - 60 * 1000),
    );
    const staleBeforeNudge = new Date(nearlyExpired.getTime() - 60 * 60 * 1000);
    assert.equal(
      shouldSendInboxNudge(
        baseCtx({ lastNudgeSentAt: nearlyExpired, earliestStaleItemUpdatedAt: staleBeforeNudge }),
      ),
      false,
    );
  });

  test("returns false: cooldown active, earliestStaleItemUpdatedAt is null (conservative)", () => {
    const oneHourAgo = new Date(NOW.getTime() - 1 * 60 * 60 * 1000);
    assert.equal(
      shouldSendInboxNudge(
        baseCtx({ lastNudgeSentAt: oneHourAgo, earliestStaleItemUpdatedAt: null }),
      ),
      false,
    );
  });

  test("returns false: cooldown active, stale item updated_at === nudge sent_at (not strictly after)", () => {
    const nudgeSentAt = new Date(NOW.getTime() - 6 * 60 * 60 * 1000);
    assert.equal(
      shouldSendInboxNudge(
        baseCtx({ lastNudgeSentAt: nudgeSentAt, earliestStaleItemUpdatedAt: nudgeSentAt }),
      ),
      false,
    );
  });

  // ── cooldown reset: fresh batch ───────────────────────────────────────────────

  test("returns true: cooldown active but all stale items arrived AFTER last nudge (fresh batch)", () => {
    const nudgeSentAt = new Date(NOW.getTime() - 6 * 60 * 60 * 1000); // 6h ago
    // New items appeared 5h ago — strictly after the nudge
    const freshItemUpdatedAt = new Date(NOW.getTime() - 5 * 60 * 60 * 1000);
    assert.equal(
      shouldSendInboxNudge(
        baseCtx({ lastNudgeSentAt: nudgeSentAt, earliestStaleItemUpdatedAt: freshItemUpdatedAt }),
      ),
      true,
    );
  });

  // ── cooldown expired ─────────────────────────────────────────────────────────

  test("returns true: last nudge exactly 24h ago (cooldown just expired)", () => {
    const exactlyExpired = new Date(
      NOW.getTime() - INBOX_NUDGE_COOLDOWN_HOURS * 60 * 60 * 1000,
    );
    const staleBeforeNudge = new Date(exactlyExpired.getTime() - 60 * 60 * 1000);
    assert.equal(
      shouldSendInboxNudge(
        baseCtx({ lastNudgeSentAt: exactlyExpired, earliestStaleItemUpdatedAt: staleBeforeNudge }),
      ),
      true,
    );
  });

  test("returns true: last nudge 25 hours ago", () => {
    const expired = new Date(NOW.getTime() - 25 * 60 * 60 * 1000);
    const staleBeforeNudge = new Date(expired.getTime() - 60 * 60 * 1000);
    assert.equal(
      shouldSendInboxNudge(
        baseCtx({ lastNudgeSentAt: expired, earliestStaleItemUpdatedAt: staleBeforeNudge }),
      ),
      true,
    );
  });

  // ── happy path ───────────────────────────────────────────────────────────────

  test("returns true: stale items, no previous nudge, digest active", () => {
    assert.equal(shouldSendInboxNudge(baseCtx()), true);
  });

  test("returns true: staleCount is 1 (minimum)", () => {
    assert.equal(shouldSendInboxNudge(baseCtx({ staleCount: 1 })), true);
  });

  test("returns true: lastNudgeSentAt is null (never nudged before)", () => {
    assert.equal(shouldSendInboxNudge(baseCtx({ lastNudgeSentAt: null })), true);
  });

  // ── combined ─────────────────────────────────────────────────────────────────

  test("returns false: digest paused even if cooldown expired", () => {
    const longAgo = new Date(NOW.getTime() - 48 * 60 * 60 * 1000);
    const staleBeforeNudge = new Date(longAgo.getTime() - 60 * 60 * 1000);
    assert.equal(
      shouldSendInboxNudge(
        baseCtx({ isDigestPaused: true, lastNudgeSentAt: longAgo, earliestStaleItemUpdatedAt: staleBeforeNudge }),
      ),
      false,
    );
  });

  test("returns false: digest paused even if fresh batch (reset ignored while paused)", () => {
    const nudgeSentAt = new Date(NOW.getTime() - 6 * 60 * 60 * 1000);
    const freshItem = new Date(NOW.getTime() - 5 * 60 * 60 * 1000);
    assert.equal(
      shouldSendInboxNudge(
        baseCtx({ isDigestPaused: true, lastNudgeSentAt: nudgeSentAt, earliestStaleItemUpdatedAt: freshItem }),
      ),
      false,
    );
  });

  test("returns false: staleCount 0 even if cooldown expired", () => {
    const longAgo = new Date(NOW.getTime() - 48 * 60 * 60 * 1000);
    assert.equal(
      shouldSendInboxNudge(
        baseCtx({ staleCount: 0, lastNudgeSentAt: longAgo, earliestStaleItemUpdatedAt: null }),
      ),
      false,
    );
  });
});

// ── buildInboxNudgeQueueEntry ─────────────────────────────────────────────────

/** 14:00 UTC on a weekday (not in quiet hours for America/Sao_Paulo, which is UTC-3 → 11:00) */
const DAYTIME = new Date("2026-06-09T14:00:00Z"); // 11:00 BRT

/** 00:30 UTC → 21:30 BRT — falls inside default quiet window (21h–07h) */
const QUIET_TIME = new Date("2026-06-10T00:30:00Z"); // 21:30 BRT

const TZ = "America/Sao_Paulo";
const Q_START = 21;
const Q_END = 7;

function baseEnqueueParams(
  overrides: Partial<InboxNudgeEnqueueParams> = {},
): InboxNudgeEnqueueParams {
  return {
    ctx: baseCtx({ now: DAYTIME }),
    hasExistingQueued: false,
    tz: TZ,
    qStart: Q_START,
    qEnd: Q_END,
    now: DAYTIME,
    ...overrides,
  };
}

describe("buildInboxNudgeQueueEntry", () => {
  // ── dedup guard ───────────────────────────────────────────────────────────────

  test("returns null when hasExistingQueued is true (dedup)", () => {
    assert.equal(
      buildInboxNudgeQueueEntry(baseEnqueueParams({ hasExistingQueued: true })),
      null,
    );
  });

  // ── suppression by shouldSendInboxNudge ───────────────────────────────────────

  test("returns null when staleCount is 0", () => {
    const ctx = baseCtx({ staleCount: 0, earliestStaleItemUpdatedAt: null, now: DAYTIME });
    assert.equal(buildInboxNudgeQueueEntry(baseEnqueueParams({ ctx })), null);
  });

  test("returns null when digest_stopped is true", () => {
    const ctx = baseCtx({ isDigestStopped: true, now: DAYTIME });
    assert.equal(buildInboxNudgeQueueEntry(baseEnqueueParams({ ctx })), null);
  });

  test("returns null when digest is paused", () => {
    const ctx = baseCtx({ isDigestPaused: true, now: DAYTIME });
    assert.equal(buildInboxNudgeQueueEntry(baseEnqueueParams({ ctx })), null);
  });

  test("returns null when cooldown active and same batch (no reset)", () => {
    const nudgeSentAt = new Date(DAYTIME.getTime() - 6 * 60 * 60 * 1000);
    const staleBeforeNudge = new Date(DAYTIME.getTime() - 10 * 60 * 60 * 1000);
    const ctx = baseCtx({ lastNudgeSentAt: nudgeSentAt, earliestStaleItemUpdatedAt: staleBeforeNudge, now: DAYTIME });
    assert.equal(buildInboxNudgeQueueEntry(baseEnqueueParams({ ctx })), null);
  });

  // ── happy path ───────────────────────────────────────────────────────────────

  test("returns a queue entry with correct message and templateName at daytime", () => {
    const entry = buildInboxNudgeQueueEntry(baseEnqueueParams());
    assert.ok(entry !== null, "entry should not be null");
    assert.ok(entry!.message.includes("3 mensagens aguardando revisão"), entry!.message);
    assert.ok(entry!.templateName.startsWith("inbox_nudge_2026-06-"), entry!.templateName);
  });

  // ── quiet-hours rescheduling ──────────────────────────────────────────────────

  test("scheduledAt is in the future when enqueued during quiet hours (21h30 BRT)", () => {
    const ctx = baseCtx({ now: QUIET_TIME });
    const entry = buildInboxNudgeQueueEntry(
      baseEnqueueParams({ ctx, now: QUIET_TIME }),
    );
    assert.ok(entry !== null, "entry should not be null");
    // scheduledAt must be strictly after QUIET_TIME — rescheduled past 07h00 BRT
    assert.ok(
      entry!.scheduledAt > QUIET_TIME,
      `scheduledAt=${entry!.scheduledAt.toISOString()} should be after quietTime=${QUIET_TIME.toISOString()}`,
    );
    // The rescheduled time must land in the 07h BRT local hour
    const localHourOfResult = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: TZ,
    }).format(entry!.scheduledAt);
    assert.equal(parseInt(localHourOfResult, 10) % 24, Q_END);
  });

  test("scheduledAt equals now (truncated to minute) when outside quiet hours", () => {
    // DAYTIME is 11:00 BRT, well outside 21h–07h quiet window
    const entry = buildInboxNudgeQueueEntry(baseEnqueueParams({ now: DAYTIME }));
    assert.ok(entry !== null);
    // Not rescheduled — scheduledAt should be <= DAYTIME (same moment or very close)
    assert.ok(
      entry!.scheduledAt.getTime() <= DAYTIME.getTime() + 5000,
      `scheduledAt=${entry!.scheduledAt.toISOString()} should not be far ahead of ${DAYTIME.toISOString()}`,
    );
  });

  // ── cooldown reset (fresh batch) ─────────────────────────────────────────────

  test("returns entry when cooldown active but fresh batch detected", () => {
    const nudgeSentAt = new Date(DAYTIME.getTime() - 6 * 60 * 60 * 1000);
    const freshItemUpdatedAt = new Date(DAYTIME.getTime() - 5 * 60 * 60 * 1000);
    const ctx = baseCtx({
      lastNudgeSentAt: nudgeSentAt,
      earliestStaleItemUpdatedAt: freshItemUpdatedAt,
      now: DAYTIME,
    });
    const entry = buildInboxNudgeQueueEntry(baseEnqueueParams({ ctx }));
    assert.ok(entry !== null, "fresh batch should allow re-nudge inside cooldown window");
  });
});
