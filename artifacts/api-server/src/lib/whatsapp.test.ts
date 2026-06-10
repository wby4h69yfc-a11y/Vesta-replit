/**
 * Unit tests for the isConsentActive outbound-gate helper.
 *
 * Run with:  pnpm --filter @workspace/api-server run test:unit
 *
 * Uses Node.js built-in test runner (node:test) — no extra test framework needed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { isConsentActive, splitMessage } from "./whatsapp.js";

const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
const past = new Date(Date.now() - 1);

// ── consent_status is not 'consented' ─────────────────────────────────────────

test("returns false when consent_status is null", () => {
  assert.equal(
    isConsentActive({ consent_status: null, consent_check_in_due_at: null }),
    false,
  );
});

test("returns false when consent_status is 'pending'", () => {
  assert.equal(
    isConsentActive({ consent_status: "pending", consent_check_in_due_at: null }),
    false,
  );
});

test("returns false when consent_status is 'revoked'", () => {
  assert.equal(
    isConsentActive({ consent_status: "revoked", consent_check_in_due_at: null }),
    false,
  );
});

test("returns false when consent_status is 'not_required'", () => {
  assert.equal(
    isConsentActive({ consent_status: "not_required", consent_check_in_due_at: future }),
    false,
  );
});

// ── consent_status === 'consented', varying expiry ────────────────────────────

test("returns true when consented and check-in due is null (no expiry set)", () => {
  assert.equal(
    isConsentActive({ consent_status: "consented", consent_check_in_due_at: null }),
    true,
  );
});

test("returns true when consented and check-in due is in the future", () => {
  assert.equal(
    isConsentActive({ consent_status: "consented", consent_check_in_due_at: future }),
    true,
  );
});

test("returns false when consented but check-in due is in the past (consent expired)", () => {
  assert.equal(
    isConsentActive({ consent_status: "consented", consent_check_in_due_at: past }),
    false,
  );
});

test("returns false when consented but check-in due is exactly now (boundary — expired)", () => {
  const now = new Date();
  assert.equal(
    isConsentActive({ consent_status: "consented", consent_check_in_due_at: now }),
    false,
  );
});

// ── splitMessage ───────────────────────────────────────────────────────────────

test("splitMessage: short message returns single-element array unchanged", () => {
  const msg = "Olá, tudo bem?";
  assert.deepEqual(splitMessage(msg), [msg]);
});

test("splitMessage: message exactly at limit returns single-element array", () => {
  const msg = "x".repeat(4096);
  const parts = splitMessage(msg);
  assert.equal(parts.length, 1);
  assert.equal(parts[0], msg);
});

test("splitMessage: message one char over limit produces two labelled parts", () => {
  const msg = "x".repeat(4097);
  const parts = splitMessage(msg);
  assert.equal(parts.length, 2);
  assert.match(parts[0], /^\(1\/2\) /);
  assert.match(parts[1], /^\(2\/2\) /);
});

test("splitMessage: no part body exceeds limit", () => {
  const msg = "a ".repeat(3000); // 6000 chars
  const parts = splitMessage(msg);
  for (const part of parts) {
    assert.ok(part.length <= 4096, `Part length ${part.length} exceeds 4096`);
  }
});

test("splitMessage: prefers paragraph boundary (\\n\\n) over line and word", () => {
  // 2500 + 2 + 2500 = 5002 chars — over limit; split should land at the \n\n
  const section1 = "a".repeat(2500);
  const section2 = "b".repeat(2500);
  const msg = `${section1}\n\n${section2}`;
  const parts = splitMessage(msg);
  assert.equal(parts.length, 2);
  assert.ok(parts[0].includes("a"), "first part should contain section1");
  assert.ok(parts[1].includes("b"), "second part should contain section2");
  assert.ok(!parts[0].includes("b"), "first part should not bleed into section2");
});

test("splitMessage: falls back to line boundary (\\n) when no paragraph boundary fits", () => {
  // 2500 + 1 + 2500 = 5001 chars — over limit; no \n\n, so split lands at the \n
  const line1 = "a".repeat(2500);
  const line2 = "b".repeat(2500);
  const msg = `${line1}\n${line2}`;
  const parts = splitMessage(msg);
  assert.equal(parts.length, 2);
  assert.ok(parts[0].includes("a"), "first part should contain line1");
  assert.ok(parts[1].includes("b"), "second part should contain line2");
});

test("splitMessage: falls back to word boundary (space) when no newline fits", () => {
  // 2500 + 1 + 2500 = 5001 chars — over the 4096 limit, one space, no newlines
  const word1 = "a".repeat(2500);
  const word2 = "b".repeat(2500);
  const msg = `${word1} ${word2}`;
  const parts = splitMessage(msg);
  assert.equal(parts.length, 2);
  assert.ok(parts[0].includes("a"), "first part should contain word1");
  assert.ok(parts[1].includes("b"), "second part should contain word2");
});

test("splitMessage: all parts together reconstruct the full content", () => {
  const lines = Array.from({ length: 100 }, (_, i) => `Tarefa ${i + 1}: fazer algo importante hoje`);
  const msg = lines.join("\n");
  const parts = splitMessage(msg);
  const reconstructed = parts.map((p) => p.replace(/^\(\d+\/\d+\) /, "")).join("\n");
  for (const line of lines) {
    assert.ok(reconstructed.includes(line), `Missing line: ${line}`);
  }
});

test("splitMessage: three-part message has correct sequential labels", () => {
  const msg = ("palavra ".repeat(200) + "\n\n").repeat(3).trim();
  const parts = splitMessage(msg);
  const N = parts.length;
  parts.forEach((part, i) => {
    assert.match(part, new RegExp(`^\\(${i + 1}\\/${N}\\) `));
  });
});
