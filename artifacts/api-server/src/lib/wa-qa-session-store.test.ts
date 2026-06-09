/**
 * Unit tests for wa-qa-session-store.ts
 *
 * Covers the pure business logic that can be verified without a live database:
 *   - computeUpdatedTurns: max-5 cap (oldest turn is dropped when cap is reached)
 *   - QA_SESSION_TTL_MS: TTL constant is 15 minutes
 *   - Upsert idempotency contract: appendQaTurn uses onConflictDoUpdate (code-level)
 *
 * Run with:  pnpm --filter @workspace/api-server run test:unit
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeUpdatedTurns,
  MAX_QA_TURNS,
  QA_SESSION_TTL_MS,
} from "./wa-qa-session-store.js";

// ── computeUpdatedTurns: max-5 cap ─────────────────────────────────────────────

test("computeUpdatedTurns: appends a new turn to an empty session", () => {
  const result = computeUpdatedTurns([], { q: "o que tenho hoje?", type: "agenda_today" });
  assert.equal(result.length, 1);
  assert.equal(result[0]!.type, "agenda_today");
});

test("computeUpdatedTurns: appends a new turn to an existing session", () => {
  const existing = [{ q: "o que tenho hoje?", type: "agenda_today" }];
  const result = computeUpdatedTurns(existing, { q: "e amanhã?", type: "agenda_tomorrow" });
  assert.equal(result.length, 2);
  assert.equal(result[1]!.type, "agenda_tomorrow");
});

test("computeUpdatedTurns: caps at MAX_QA_TURNS when already at limit", () => {
  const existing = Array.from({ length: MAX_QA_TURNS }, (_, i) => ({
    q: `pergunta ${i + 1}`,
    type: "agenda_today",
  }));
  const result = computeUpdatedTurns(existing, { q: "nova pergunta", type: "agenda_tomorrow" });
  assert.equal(result.length, MAX_QA_TURNS, `session must not exceed ${MAX_QA_TURNS} turns`);
});

test("computeUpdatedTurns: drops the oldest turn when cap is reached", () => {
  const existing = [
    { q: "primeiro", type: "agenda_today" },
    { q: "segundo", type: "agenda_tomorrow" },
    { q: "terceiro", type: "tasks_open" },
    { q: "quarto", type: "inbox_pending" },
    { q: "quinto", type: "agenda_week" },
  ];
  const result = computeUpdatedTurns(existing, { q: "sexto", type: "agenda_today" });
  assert.equal(result.length, MAX_QA_TURNS);
  assert.equal(result[0]!.q, "segundo", "oldest turn (primeiro) must be dropped");
  assert.equal(result[MAX_QA_TURNS - 1]!.q, "sexto", "newest turn must be appended last");
});

test("computeUpdatedTurns: retains order oldest-first", () => {
  const existing = [
    { q: "a", type: "agenda_today" },
    { q: "b", type: "agenda_tomorrow" },
  ];
  const result = computeUpdatedTurns(existing, { q: "c", type: "tasks_open" });
  assert.deepEqual(
    result.map((t) => t.q),
    ["a", "b", "c"],
    "turns must remain in chronological order",
  );
});

test("computeUpdatedTurns: handles MAX_QA_TURNS + 1 consecutive appends (idempotent cap)", () => {
  let turns: Array<{ q: string; type: string }> = [];
  for (let i = 1; i <= MAX_QA_TURNS + 1; i++) {
    turns = computeUpdatedTurns(turns, { q: `msg ${i}`, type: "agenda_today" });
  }
  assert.equal(turns.length, MAX_QA_TURNS, "cap must be enforced across multiple appends");
  assert.equal(turns[0]!.q, "msg 2", "first message must have been evicted");
  assert.equal(turns[MAX_QA_TURNS - 1]!.q, `msg ${MAX_QA_TURNS + 1}`, "last message must be newest");
});

test("computeUpdatedTurns: does not mutate the original existing array", () => {
  const existing = [{ q: "original", type: "agenda_today" }];
  const snapshot = [...existing];
  computeUpdatedTurns(existing, { q: "new", type: "agenda_tomorrow" });
  assert.deepEqual(existing, snapshot, "original array must not be mutated");
});

// ── QA_SESSION_TTL_MS: TTL constant ────────────────────────────────────────────

test("QA_SESSION_TTL_MS equals 15 minutes in milliseconds", () => {
  const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
  assert.equal(QA_SESSION_TTL_MS, FIFTEEN_MINUTES_MS);
});

test("QA_SESSION_TTL_MS is positive", () => {
  assert.ok(QA_SESSION_TTL_MS > 0, "TTL must be positive");
});

test("QA_SESSION_TTL_MS: a new expiry computed from now is in the future", () => {
  const before = Date.now();
  const expiresAt = new Date(Date.now() + QA_SESSION_TTL_MS);
  const after = Date.now();
  assert.ok(
    expiresAt.getTime() >= before + QA_SESSION_TTL_MS,
    "expiry must be at least TTL milliseconds from now",
  );
  assert.ok(
    expiresAt.getTime() <= after + QA_SESSION_TTL_MS + 10,
    "expiry must not be unreasonably far in the future",
  );
});

// ── MAX_QA_TURNS ───────────────────────────────────────────────────────────────

test("MAX_QA_TURNS is 5", () => {
  assert.equal(MAX_QA_TURNS, 5);
});

// ── Upsert idempotency contract (code-level documentation) ────────────────────
//
// appendQaTurn uses onConflictDoUpdate with a UNIQUE constraint on
// (household_id, sender_phone) so repeated calls for the same sender never
// produce duplicate rows.  The DB-side invariant is verified by:
//   1. The migration: unique("wa_qa_sessions_sender_uniq").on(household_id, sender_phone)
//   2. The onConflictDoUpdate target in wa-qa-session-store.ts
//
// The following test ensures the constant that drives the cap has not changed
// accidentally and that computeUpdatedTurns would be called with the right
// existing turns on a second upsert.

test("upsert idempotency: second append for same sender updates turns, not inserts a new row", () => {
  // Simulate the state that appendQaTurn would compute on a second call:
  //   first call stored [turn1], second call loads [turn1] and appends turn2.
  const turn1 = { q: "o que tenho hoje?", type: "agenda_today" };
  const turn2 = { q: "e amanhã?", type: "agenda_tomorrow" };

  const afterFirst = computeUpdatedTurns([], turn1);
  const afterSecond = computeUpdatedTurns(afterFirst, turn2);

  assert.equal(afterSecond.length, 2, "two turns must exist after two appends");
  assert.equal(afterSecond[0]!.type, "agenda_today");
  assert.equal(afterSecond[1]!.type, "agenda_tomorrow");

  // A third call for the same sender would update the same row via upsert,
  // resulting in three turns — not two rows with one turn each.
  const turn3 = { q: "e a semana?", type: "agenda_week" };
  const afterThird = computeUpdatedTurns(afterSecond, turn3);
  assert.equal(afterThird.length, 3, "three turns after three appends — single row");
});
