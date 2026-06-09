/**
 * Unit tests for the isConsentActive outbound-gate helper.
 *
 * Run with:  pnpm --filter @workspace/api-server run test:unit
 *
 * Uses Node.js built-in test runner (node:test) — no extra test framework needed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { isConsentActive } from "./whatsapp.js";

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
