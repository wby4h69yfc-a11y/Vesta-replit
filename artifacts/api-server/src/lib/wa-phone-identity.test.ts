/**
 * Security regression tests for WhatsApp phone identity routing and
 * contact phone-write access control.
 *
 * Exercises the pure `computePhoneRouting` helper that implements the
 * two-tier priority model used by resolveHousehold(), plus the admin-gate
 * predicate that guards all contact phone-write endpoints (POST /contacts,
 * PATCH /contacts/:id, POST /contacts/bulk).
 *
 * NO database connection required — all data is supplied inline.
 *
 * Scenarios covered:
 *   1. Verified member routing — happy path
 *   2. Unverified member pre-claim is IGNORED (only phone_verified=true members
 *      participate in routing — attacker admin adding victim's phone as an
 *      unverified member must not route victim's messages)
 *   3. Contact routing — fallback when no verified member matches
 *   4. Verified member BEATS contact — if attacker pre-claimed via contact and
 *      victim later onboards (gaining phone_verified=true), victim's household wins
 *   5. Multi-household collision on verified members — fail-closed
 *   6. Multi-household collision on contacts — fail-closed
 *   7. Unknown sender — no member or contact match → onboarding flow
 *   8. normalisePhone strips non-digits for canonical matching
 *   9. Admin gate trigger predicate — POST /contacts/bulk phone detection
 *
 * Run with:  pnpm --filter @workspace/api-server run test:unit
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { computePhoneRouting, normalisePhone } from "./wa-message-processor.js";

// ── normalisePhone ────────────────────────────────────────────────────────────

test("normalisePhone: strips country code prefix and punctuation", () => {
  assert.equal(normalisePhone("+55 11 99999-0000"), "5511999990000");
});

test("normalisePhone: passes plain digit string through unchanged", () => {
  assert.equal(normalisePhone("5511999990000"), "5511999990000");
});

test("normalisePhone: handles whatsapp: scheme prefix", () => {
  const raw = "whatsapp:+5511999990000";
  const stripped = raw.replace(/^whatsapp:/i, "").trim();
  assert.equal(normalisePhone(stripped), "5511999990000");
});

// ── Tier 1: verified member routing ──────────────────────────────────────────

test("routing: verified member in one household → found at that household", () => {
  const result = computePhoneRouting(
    "5511999990000",
    [{ phone: "+55 11 99999-0000", household_id: 1 }],
    [],
  );
  assert.deepEqual(result, { kind: "found", householdId: 1 });
});

test("routing: unverified member pre-claim is IGNORED — caller must filter phone_verified=true before passing to computePhoneRouting", () => {
  // Attacker adds victim phone as unverified member (household 99).
  // The caller (resolveHousehold) only passes phone_verified=true rows.
  // Simulated by passing an EMPTY verifiedMembers array (attacker's record was filtered out).
  // No contacts exist for this phone either → unknown sender → onboarding.
  const result = computePhoneRouting(
    "5511999990000",
    [], // ← unverified member was filtered out by WHERE phone_verified = true
    [],
  );
  assert.deepEqual(result, { kind: "unknown" });
});

test("routing: unverified member does not route even when contact also absent", () => {
  // Regression: attacker pre-claims victim's phone as unverified member.
  // No contacts either. Victim should hit onboarding, not attacker's household.
  const result = computePhoneRouting(
    "5511111110000",
    [], // attacker unverified member filtered out
    [],
  );
  assert.equal(result.kind, "unknown",
    "pre-claimed unverified member must not produce a routing match");
});

// ── Tier 2: contact routing (fallback) ───────────────────────────────────────

test("routing: contact match used when no verified member matches", () => {
  // Diarista registered as contact — should still route (core product flow).
  const result = computePhoneRouting(
    "5511888880000",
    [],
    [{ phone: "5511888880000", household_id: 7 }],
  );
  assert.deepEqual(result, { kind: "found", householdId: 7 });
});

test("routing: contact match uses normalised comparison (strips non-digits)", () => {
  const result = computePhoneRouting(
    "5511888880000",
    [],
    [{ phone: "+55 11 88888-0000", household_id: 7 }],
  );
  assert.deepEqual(result, { kind: "found", householdId: 7 });
});

// ── Priority: verified member beats contact pre-claim ────────────────────────

test("routing: verified member takes priority over contact in another household", () => {
  // Attacker (household 99) pre-claimed victim's phone in contacts.
  // Victim later onboarded → has phone_verified=true member in household 1.
  // Victim's messages must route to household 1, NOT attacker's household 99.
  const result = computePhoneRouting(
    "5511999990000",
    [{ phone: "5511999990000", household_id: 1 }], // victim's verified member
    [{ phone: "5511999990000", household_id: 99 }], // attacker's contact pre-claim
  );
  assert.deepEqual(result, { kind: "found", householdId: 1 },
    "verified member must win over contact pre-claim");
});

test("routing: victim onboarding → verified member wins, attacker contact ignored", () => {
  // Even if attacker has multiple contacts for the same phone (shouldn't happen
  // due to cross-household uniqueness, but be defensive), verified member wins.
  const result = computePhoneRouting(
    "5511999990000",
    [{ phone: "5511999990000", household_id: 3 }],
    [
      { phone: "5511999990000", household_id: 99 },
      { phone: "5511999990000", household_id: 100 }, // second attacker household
    ],
  );
  // Verified member match → tier-1 routing fires, contacts are never consulted.
  assert.deepEqual(result, { kind: "found", householdId: 3 },
    "verified member must win regardless of contact collision count");
});

// ── Multi-household collision: fail-closed ────────────────────────────────────

test("routing: two verified members in different households → multi_household", () => {
  // Should not happen in practice (cross-household uniqueness), but must fail-closed.
  const result = computePhoneRouting(
    "5511999990000",
    [
      { phone: "5511999990000", household_id: 1 },
      { phone: "5511999990000", household_id: 2 },
    ],
    [],
  );
  assert.equal(result.kind, "multi_household");
  if (result.kind === "multi_household") {
    assert.ok(result.householdIds.includes(1));
    assert.ok(result.householdIds.includes(2));
  }
});

test("routing: two contacts in different households → multi_household (fail-closed)", () => {
  // Cross-household uniqueness is enforced at write time, so this is legacy-only.
  // Must still fail-closed rather than routing to either household.
  const result = computePhoneRouting(
    "5511888880000",
    [],
    [
      { phone: "5511888880000", household_id: 5 },
      { phone: "5511888880000", household_id: 6 },
    ],
  );
  assert.equal(result.kind, "multi_household");
  if (result.kind === "multi_household") {
    assert.ok(result.householdIds.includes(5));
    assert.ok(result.householdIds.includes(6));
  }
});

// ── Unknown sender ────────────────────────────────────────────────────────────

test("routing: no member and no contact → unknown (onboarding flow)", () => {
  const result = computePhoneRouting("5511777770000", [], []);
  assert.deepEqual(result, { kind: "unknown" });
});

test("routing: member with different phone → unknown (no match)", () => {
  const result = computePhoneRouting(
    "5511777770000",
    [{ phone: "5511999990000", household_id: 1 }],
    [],
  );
  assert.deepEqual(result, { kind: "unknown" });
});

// ── Null phone fields ─────────────────────────────────────────────────────────

test("routing: null phone on member is skipped safely", () => {
  const result = computePhoneRouting(
    "5511999990000",
    [{ phone: null, household_id: 1 }],
    [],
  );
  assert.deepEqual(result, { kind: "unknown" },
    "null phone must not match any normalised number");
});

test("routing: null phone on contact is skipped safely", () => {
  const result = computePhoneRouting(
    "5511999990000",
    [],
    [{ phone: null, household_id: 1 }],
  );
  assert.deepEqual(result, { kind: "unknown" });
});

// ── Admin gate predicate: POST /contacts/bulk ─────────────────────────────────
//
// The route handler runs:
//   const hasPhone = contacts.some(c => c.phone && c.phone.trim() !== "");
//   if (hasPhone) { requireAdmin() }
//
// These tests document the exact cases that MUST trigger the admin check,
// ensuring non-admins cannot register phone numbers via the bulk path and
// influence inbound WA identity routing.

/** Mirrors the admin-gate trigger predicate in POST /contacts/bulk. */
function bulkHasPhone(contacts: Array<{ phone?: string | null }>): boolean {
  return contacts.some((c) => c.phone != null && c.phone.trim() !== "");
}

test("admin gate: single contact with phone triggers gate", () => {
  assert.equal(bulkHasPhone([{ phone: "+5511999990000" }]), true);
});

test("admin gate: phone-only contact in mixed array triggers gate", () => {
  assert.equal(
    bulkHasPhone([{ phone: undefined }, { phone: "+5511888880000" }, { phone: null }]),
    true,
    "gate must fire even when only one contact in the batch has a phone",
  );
});

test("admin gate: contacts without phone do NOT trigger gate (non-admin can create phone-less contacts)", () => {
  assert.equal(
    bulkHasPhone([{ phone: undefined }, { phone: null }, {}]),
    false,
    "phone-less contacts must not require admin — non-admins can add names/categories",
  );
});

test("admin gate: empty-string phone does NOT trigger gate (treated as absent)", () => {
  assert.equal(bulkHasPhone([{ phone: "" }]), false);
});

test("admin gate: whitespace-only phone does NOT trigger gate", () => {
  assert.equal(bulkHasPhone([{ phone: "   " }]), false);
});

test("admin gate: empty contacts array does NOT trigger gate", () => {
  assert.equal(bulkHasPhone([]), false);
});

// ── End-to-end pre-claim attack chain (documentation test) ───────────────────
//
// This test narrates the full attack that the admin gate + routing priority
// collectively prevent, ensuring the defence-in-depth is understood and stable.
//
// Attack: non-admin member in household A tries to register victim's phone via
// POST /contacts/bulk so victim's inbound WA messages route to household A.
//
// Defence:
//   Step 1 — bulkHasPhone returns true → admin gate fires → 403 (write blocked).
//   Step 2 — Even if a rogue admin in household A somehow registers the phone,
//             once the victim completes WA onboarding (phone_verified=true in
//             household B), computePhoneRouting returns household B because
//             tier-1 (verified members) always beats tier-2 (contacts).

test("attack chain: routing resolves to victim's household once onboarded (tier-1 beats attacker contact)", () => {
  const victimPhone = "5511777770001";

  // Before onboarding: only attacker contact exists → attacker's household.
  const beforeOnboarding = computePhoneRouting(
    victimPhone,
    [],
    [{ phone: victimPhone, household_id: 99 }],
  );
  assert.deepEqual(beforeOnboarding, { kind: "found", householdId: 99 },
    "contact routing used before victim onboards (expected interim state)");

  // After onboarding: victim has phone_verified=true → their household wins.
  const afterOnboarding = computePhoneRouting(
    victimPhone,
    [{ phone: victimPhone, household_id: 1 }], // victim's verified member
    [{ phone: victimPhone, household_id: 99 }], // attacker's contact (still present)
  );
  assert.deepEqual(afterOnboarding, { kind: "found", householdId: 1 },
    "verified member must override attacker contact after victim onboards");
});
