/**
 * Security regression tests for WhatsApp phone identity routing and
 * contact phone-write access control.
 *
 * Exercises the pure `computePhoneRouting` helper that implements the
 * two-tier priority model used by resolveHousehold(), the `decideContactGate`
 * helper that blocks ingestion for unverified tier-2 contact phones, the
 * `isConsentKeyword` predicate, plus the admin-gate predicate that guards all
 * contact phone-write endpoints (POST /contacts, PATCH /contacts/:id,
 * POST /contacts/bulk).
 *
 * NO database connection required — all data is supplied inline.
 *
 * Scenarios covered:
 *   1. Verified member routing — happy path
 *   2. Unverified member pre-claim is IGNORED (only phone_verified=true members
 *      participate in routing — attacker admin adding victim's phone as an
 *      unverified member must not route victim's messages)
 *   3. Contact routing — fallback when no verified member matches AND the
 *      contact has an active consent relationship (pending/consented)
 *   4. Contact pre-claim (NULL / 'revoked' consent) does NOT route — closes the
 *      cross-household hijack where an admin claims a victim's external number
 *   5. Verified member BEATS contact — if attacker pre-claimed via contact and
 *      victim later onboards (gaining phone_verified=true), victim's household wins
 *   6. Multi-household collision on verified members / contacts — fail-closed
 *   7. Unknown sender — no member or contact match → onboarding flow
 *   8. decideContactGate — only 'consented' contacts may ingest; 'pending' may
 *      only answer their consent prompt; everything else is dropped
 *   9. isConsentKeyword — SIM / NÃO / NAO / REVOGAR detection
 *  10. normalisePhone strips non-digits for canonical matching
 *  11. Admin gate trigger predicate — POST /contacts/bulk phone detection
 *
 * Run with:  pnpm --filter @workspace/api-server run test:unit
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computePhoneRouting,
  decideContactGate,
  isConsentKeyword,
  normalisePhone,
} from "./wa-message-processor.js";

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

// ── Tier 2: contact routing (fallback, requires active consent) ──────────────

test("routing: consented contact match used when no verified member matches", () => {
  // Diarista who replied SIM (consent_status='consented') — core product flow.
  const result = computePhoneRouting(
    "5511888880000",
    [],
    [{ phone: "5511888880000", household_id: 7, consent_status: "consented" }],
  );
  assert.deepEqual(result, { kind: "found", householdId: 7 });
});

test("routing: pending contact still routes (so the consent reply can be processed)", () => {
  // A contact who was sent a consent request (status='pending') must route so
  // their SIM/NÃO reply reaches applyConsentReply. The section 4.05 gate then
  // blocks ingestion of any non-consent message from them.
  const result = computePhoneRouting(
    "5511888880000",
    [],
    [{ phone: "5511888880000", household_id: 7, consent_status: "pending" }],
  );
  assert.deepEqual(result, { kind: "found", householdId: 7 });
});

test("routing: contact match uses normalised comparison (strips non-digits)", () => {
  const result = computePhoneRouting(
    "5511888880000",
    [],
    [{ phone: "+55 11 88888-0000", household_id: 7, consent_status: "consented" }],
  );
  assert.deepEqual(result, { kind: "found", householdId: 7 });
});

// ── Contact pre-claim (no active consent) MUST NOT route ─────────────────────

test("routing: NULL-consent contact pre-claim does NOT route → unknown (onboarding)", () => {
  // THE CORE FIX: a malicious admin pre-claims a victim's external number as a
  // contact. consent_status defaults to NULL. The victim's inbound messages must
  // NOT be hijacked into the attacker's household — they fall through to onboarding.
  const result = computePhoneRouting(
    "5511888880000",
    [],
    [{ phone: "5511888880000", household_id: 99, consent_status: null }],
  );
  assert.deepEqual(result, { kind: "unknown" },
    "a bare pre-claimed contact (NULL consent) must never drive routing");
});

test("routing: revoked contact does NOT route → unknown", () => {
  // A contact who revoked consent must not have their messages routed/ingested.
  const result = computePhoneRouting(
    "5511888880000",
    [],
    [{ phone: "5511888880000", household_id: 99, consent_status: "revoked" }],
  );
  assert.deepEqual(result, { kind: "unknown" },
    "a 'revoked' contact must never drive routing");
});

test("routing: NULL-consent pre-claim ignored even when a real consented contact exists elsewhere", () => {
  // Pre-claim in household 99 (NULL) is filtered out; the genuine consented
  // contact in household 7 is the only routable match.
  const result = computePhoneRouting(
    "5511888880000",
    [],
    [
      { phone: "5511888880000", household_id: 99, consent_status: null },
      { phone: "5511888880000", household_id: 7, consent_status: "consented" },
    ],
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
    [{ phone: "5511999990000", household_id: 99, consent_status: "consented" }], // attacker's contact
  );
  assert.deepEqual(result, { kind: "found", householdId: 1 },
    "verified member must win over contact pre-claim");
});

test("routing: victim onboarding → verified member wins, attacker contacts ignored", () => {
  // Even if attacker has multiple contacts for the same phone (shouldn't happen
  // due to cross-household uniqueness, but be defensive), verified member wins.
  const result = computePhoneRouting(
    "5511999990000",
    [{ phone: "5511999990000", household_id: 3 }],
    [
      { phone: "5511999990000", household_id: 99, consent_status: "consented" },
      { phone: "5511999990000", household_id: 100, consent_status: "consented" }, // second attacker household
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

test("routing: two consented contacts in different households → multi_household (fail-closed)", () => {
  // Cross-household uniqueness is enforced at write time, so this is legacy-only.
  // Must still fail-closed rather than routing to either household.
  const result = computePhoneRouting(
    "5511888880000",
    [],
    [
      { phone: "5511888880000", household_id: 5, consent_status: "consented" },
      { phone: "5511888880000", household_id: 6, consent_status: "consented" },
    ],
  );
  assert.equal(result.kind, "multi_household");
  if (result.kind === "multi_household") {
    assert.ok(result.householdIds.includes(5));
    assert.ok(result.householdIds.includes(6));
  }
});

test("routing: collision ignores the NULL-consent contact, routes to the only consented one", () => {
  // A genuine consented contact in household 5 collides with a NULL pre-claim in
  // household 6. The pre-claim is filtered out, so there is no collision and the
  // consented contact routes cleanly.
  const result = computePhoneRouting(
    "5511888880000",
    [],
    [
      { phone: "5511888880000", household_id: 5, consent_status: "consented" },
      { phone: "5511888880000", household_id: 6, consent_status: null },
    ],
  );
  assert.deepEqual(result, { kind: "found", householdId: 5 });
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
    [{ phone: null, household_id: 1, consent_status: "consented" }],
  );
  assert.deepEqual(result, { kind: "unknown" });
});

// ── decideContactGate: ingestion proof-of-control gate ───────────────────────
//
// For a TIER-2 (contact-routed, no verified member) sender, only a 'consented'
// contact — one that proved control of the phone with a SIM reply — may have its
// messages ingested. A 'pending' contact may ONLY answer its consent prompt.
// Everything else is dropped (no ingestion, no reply).

test("gate: consented contact → ingest (general message processed)", () => {
  assert.equal(decideContactGate("consented", false), "ingest");
});

test("gate: consented contact + consent keyword → still ingest (e.g. REVOGAR handled downstream)", () => {
  assert.equal(decideContactGate("consented", true), "ingest");
});

test("gate: pending contact + consent keyword → consent_reply (mutation only)", () => {
  assert.equal(decideContactGate("pending", true), "consent_reply");
});

test("gate: pending contact + general message → ignore (no ingestion)", () => {
  assert.equal(decideContactGate("pending", false), "ignore",
    "a pending contact's non-consent message must NOT be ingested");
});

test("gate: NULL-consent contact → ignore regardless of body", () => {
  assert.equal(decideContactGate(null, true), "ignore");
  assert.equal(decideContactGate(null, false), "ignore");
});

test("gate: revoked contact → ignore regardless of body", () => {
  assert.equal(decideContactGate("revoked", true), "ignore");
  assert.equal(decideContactGate("revoked", false), "ignore");
});

// ── isConsentKeyword ──────────────────────────────────────────────────────────

test("consent keyword: SIM / NÃO / NAO / REVOGAR detected (case/whitespace-insensitive)", () => {
  assert.equal(isConsentKeyword("SIM"), true);
  assert.equal(isConsentKeyword(" sim "), true);
  assert.equal(isConsentKeyword("Não"), true);
  assert.equal(isConsentKeyword("nao"), true);
  assert.equal(isConsentKeyword("REVOGAR"), true);
});

test("consent keyword: general text / empty / null is NOT a consent keyword", () => {
  assert.equal(isConsentKeyword("olá, pode vir amanhã?"), false);
  assert.equal(isConsentKeyword(""), false);
  assert.equal(isConsentKeyword(null), false);
  assert.equal(isConsentKeyword(undefined), false);
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
// This test narrates the full attack that the admin gate + routing priority +
// consent gate collectively prevent, ensuring the defence-in-depth is understood
// and stable.
//
// Attack: an admin (or a non-admin via the bulk path) in household A registers a
// victim's external phone as a contact so the victim's inbound WA messages route
// to household A.
//
// Defence:
//   Step 0 — bulkHasPhone returns true → admin gate fires → non-admins blocked.
//   Step 1 — A bare pre-claim has consent_status = NULL, so computePhoneRouting
//             returns `unknown`: the victim's messages go to onboarding, NOT
//             household A. (This is the fix added in the phone-identity hardening.)
//   Step 2 — Even if household A later drives the contact to 'consented' somehow,
//             once the victim completes WA onboarding (phone_verified=true in
//             household B), tier-1 (verified members) always beats tier-2.

test("attack chain: bare contact pre-claim does NOT route (NULL consent → unknown)", () => {
  const victimPhone = "5511777770001";

  // Bare pre-claim by attacker household 99, consent_status defaults to NULL.
  const preClaim = computePhoneRouting(
    victimPhone,
    [],
    [{ phone: victimPhone, household_id: 99, consent_status: null }],
  );
  assert.deepEqual(preClaim, { kind: "unknown" },
    "a bare contact pre-claim must not hijack the victim's inbound messages");
});

test("attack chain: verified member overrides attacker contact after victim onboards", () => {
  const victimPhone = "5511777770001";

  // After onboarding: victim has phone_verified=true → their household wins even
  // if the attacker somehow drove their contact to 'consented'.
  const afterOnboarding = computePhoneRouting(
    victimPhone,
    [{ phone: victimPhone, household_id: 1 }], // victim's verified member
    [{ phone: victimPhone, household_id: 99, consent_status: "consented" }], // attacker's contact
  );
  assert.deepEqual(afterOnboarding, { kind: "found", householdId: 1 },
    "verified member must override attacker contact after victim onboards");
});
