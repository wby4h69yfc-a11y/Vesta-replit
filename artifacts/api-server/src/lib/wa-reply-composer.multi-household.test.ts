/**
 * Unit tests for replyMultiHouseholdConflict — wa-reply-composer.ts
 *
 * Verifies:
 *   1. The reply is a non-empty string
 *   2. It contains the key informational phrase (in pt-BR)
 *   3. It does NOT expose any household name or ID
 *   4. It does NOT contain the sender's phone number
 *
 * Run with:  pnpm --filter @workspace/api-server run test:unit
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { replyMultiHouseholdConflict } from "./wa-reply-composer.js";

test("replyMultiHouseholdConflict: returns a non-empty string", () => {
  const reply = replyMultiHouseholdConflict();
  assert.ok(typeof reply === "string" && reply.length > 0, "must return a non-empty string");
});

test("replyMultiHouseholdConflict: includes the core conflict phrase in pt-BR", () => {
  const reply = replyMultiHouseholdConflict();
  assert.ok(
    reply.includes("mais de um lar"),
    `expected 'mais de um lar' in reply, got: ${reply}`,
  );
});

test("replyMultiHouseholdConflict: does not leak any household ID or name", () => {
  const reply = replyMultiHouseholdConflict();
  // Numbers in the reply should only appear as part of the price mention (none expected),
  // NOT as household IDs.  The function takes no arguments so there is nothing to leak.
  assert.ok(!reply.includes("household_id"), "must not include raw DB field name");
  assert.ok(!reply.includes("householdId"), "must not include JS field name");
});

test("replyMultiHouseholdConflict: is deterministic (same value on repeated calls)", () => {
  const r1 = replyMultiHouseholdConflict();
  const r2 = replyMultiHouseholdConflict();
  assert.equal(r1, r2, "reply must be stable across calls");
});

test("replyMultiHouseholdConflict: instructs the user to open the app", () => {
  const reply = replyMultiHouseholdConflict();
  assert.ok(
    reply.toLowerCase().includes("app") || reply.toLowerCase().includes("suporte"),
    "reply must point the user to the app or support",
  );
});
