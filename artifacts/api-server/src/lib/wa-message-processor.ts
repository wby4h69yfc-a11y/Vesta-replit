/**
 * WhatsAppMessageProcessor
 *
 * Receives a normalised inbound WhatsApp payload, resolves the owning
 * household, creates an inbox item, triggers AI classification, and
 * returns a typed outcome the webhook handler can act on.
 *
 * All DB mutations are scoped to the resolved household — there are no
 * cross-household reads or writes after the household is resolved.
 */

import type { Logger } from "pino";
import { db } from "@workspace/db";
import {
  inboxItemsTable,
  contactsTable,
  membersTable,
  suggestedActionsTable,
} from "@workspace/db";
import { eq, and, or } from "drizzle-orm";
import { classifyAndSaveAction } from "./classifier";
import { processWhatsAppMedia } from "./media-analysis";
import { looksLikeToken, markTokenVerified } from "./wa-token-store";
import { handleApprovalResponse } from "./wa-approval-handler";
import { recordPrompt } from "./wa-prompt-store";
import { detectPatternsForHousehold } from "./pattern-detector";

/** Payload shape normalised by the webhook handler before calling us. */
export interface InboundWAMessage {
  /** Raw From field, e.g. "whatsapp:+5511999990000" */
  from: string;
  /** Message text, already trimmed. Empty string for media-only messages. */
  body: string;
  /** Display name Twilio provides from the WA profile */
  profileName?: string | null;
  /** Present when NumMedia > 0 */
  mediaUrl?: string | null;
  mediaContentType?: string | null;
  numMedia?: string | null;
  /** Twilio message SID for deduplication */
  messageSid?: string | null;
}

export type ProcessOutcome =
  | { kind: "token_verified"; userId: string; phone: string }
  | { kind: "token_expired"; phone: string }
  | { kind: "empty_message" }
  | { kind: "duplicate"; messageSid: string }
  | { kind: "unknown_sender"; phone: string }
  | { kind: "multi_household"; phone: string }
  | { kind: "media_rate_limited"; phone: string }
  | { kind: "approved_via_wa"; actionId: number; actionTitle: string; householdId: number; phone: string }
  | { kind: "dismissed_via_wa"; actionId: number; householdId: number; phone: string }
  | { kind: "edited_via_wa"; actionId: number; newTitle: string; householdId: number; phone: string }
  | { kind: "undone_via_wa"; actionTitle: string; householdId: number; phone: string }
  | { kind: "consent_updated"; contactId: number; newStatus: "consented" | "revoked"; phone: string; householdId: number; contactName: string }
  | {
      kind: "ingested";
      inboxItemId: number;
      householdId: number;
      phone: string;
      approvalLevel: string;
      senderName: string | null;
      consentGranted: boolean;
      actionTitle: string | null;
      actionType: string | null;
      actionCategory: string | null;
      actionDatetime: string | null;
    };

/** Strip all non-digit chars for exact phone matching. */
function normalisePhone(p: string): string {
  return p.replace(/\D/g, "");
}

// ── Per-sender media rate limiting ────────────────────────────────────────────
// Limits unbounded media download + AI processing to at most MEDIA_RATE_LIMIT
// messages per MEDIA_RATE_WINDOW_MS per sender, preventing resource exhaustion
// by any single recognized WhatsApp number.

const MEDIA_RATE_LIMIT = 10;
const MEDIA_RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const mediaRateLimitStore = new Map<string, RateLimitEntry>();

function checkMediaRateLimit(phoneNorm: string): boolean {
  const now = Date.now();
  const entry = mediaRateLimitStore.get(phoneNorm);
  if (!entry || now - entry.windowStart > MEDIA_RATE_WINDOW_MS) {
    mediaRateLimitStore.set(phoneNorm, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= MEDIA_RATE_LIMIT) {
    return false;
  }
  entry.count++;
  return true;
}

type MatchedMember = {
  name: string;
  phone: string | null;
  household_id: number;
  role: string;
  created_at: Date;
};
type MatchedContact = {
  id: number;
  name: string;
  phone: string | null;
  household_id: number;
  consent_status: string | null;
  created_at: Date;
};

type ResolvedHousehold = {
  householdId: number;
  matchedMembers: MatchedMember[];
  matchedContacts: MatchedContact[];
};

/**
 * Resolves the single owning household for a normalised phone number.
 *
 * Resolution rules (strict, fail-closed):
 *
 * 1. Member matches take absolute priority over contact matches.
 *    Members are household-owned (created by admins); a contact registration
 *    in another household cannot override a member-based ownership claim.
 *    - Exactly one household has a member with this phone → route there.
 *    - Multiple member households → unresolvable (fail-closed, discard).
 *      Routing ambiguous member ownership risks cross-tenant misdelivery, so
 *      we prefer safe rejection regardless of tier.
 *
 * 2. No member matches → fall back to contact matches.
 *    - Exactly one household has a contact with this phone → route there.
 *    - Multiple contact households → unresolvable (fail-closed, discard).
 *
 * The data entry layer (POST /contacts, PATCH /contacts/:id, POST /contacts/bulk)
 * enforces that phone numbers must be unique across all households. Together,
 * those two controls prevent new collisions from being created in the first
 * place, so the fail-closed path here should only be reached for legacy data
 * that predates the uniqueness constraint.
 *
 * Returns null when no match exists or when resolution is ambiguous.
 */
async function resolveHousehold(
  phoneNorm: string,
  log: Logger,
  phoneRaw: string,
): Promise<ResolvedHousehold | null> {
  const allContacts = await db
    .select({
      id: contactsTable.id,
      name: contactsTable.name,
      phone: contactsTable.phone,
      household_id: contactsTable.household_id,
      consent_status: contactsTable.consent_status,
      created_at: contactsTable.created_at,
    })
    .from(contactsTable);

  const allMembers = await db
    .select({
      name: membersTable.name,
      phone: membersTable.phone,
      household_id: membersTable.household_id,
      role: membersTable.role,
      created_at: membersTable.created_at,
    })
    .from(membersTable);

  const matchedContacts: MatchedContact[] = allContacts.filter(
    (c) => c.phone && normalisePhone(c.phone) === phoneNorm,
  );
  const matchedMembers: MatchedMember[] = allMembers.filter(
    (m) => m.phone && normalisePhone(m.phone) === phoneNorm,
  );

  // ── Priority 1: member matches — authoritative, wins over any contact match ─
  if (matchedMembers.length > 0) {
    const memberHouseholdIds = new Set(matchedMembers.map((m) => m.household_id));

    if (memberHouseholdIds.size === 1) {
      // Unambiguous member ownership → route regardless of contact matches elsewhere.
      return { householdId: [...memberHouseholdIds][0], matchedMembers, matchedContacts };
    }

    // Multiple households each claim this phone via a member record.
    // Fail-closed: no routing guess, no tie-breaker.
    log.warn(
      { phone: phoneRaw, households: [...memberHouseholdIds] },
      "Phone matched multiple member households — discarding to prevent cross-tenant misdelivery",
    );
    return null;
  }

  // ── Priority 2: contact-only matches ─────────────────────────────────────
  if (matchedContacts.length === 0) {
    return null; // truly unknown sender
  }

  const contactHouseholdIds = new Set(matchedContacts.map((c) => c.household_id));

  if (contactHouseholdIds.size === 1) {
    return { householdId: [...contactHouseholdIds][0], matchedMembers, matchedContacts };
  }

  // Multiple households have this phone as a contact; fail-closed.
  log.warn(
    { phone: phoneRaw, households: [...contactHouseholdIds] },
    "Phone matched multiple contact households — discarding to prevent cross-tenant misdelivery",
  );
  return null;
}

/**
 * Processes one inbound WhatsApp event end-to-end.
 * Returns a typed outcome so the caller (webhook handler) decides
 * what reply to send — keeps reply side effects out of this function.
 */
export async function processInboundWAMessage(
  payload: InboundWAMessage,
  log: Logger,
): Promise<ProcessOutcome> {
  const phoneRaw = payload.from.replace(/^whatsapp:/i, "").trim();
  const phoneNorm = normalisePhone(phoneRaw);
  const bodyText = payload.body;

  // ── 1. Onboarding token intercept ─────────────────────────────────────────
  if (looksLikeToken(bodyText)) {
    // Pass the sender's phone so the store can bind verification to the number
    // that actually sent the token — used by /onboarding/complete.
    const userId = markTokenVerified(bodyText, phoneRaw);
    if (userId) {
      log.info({ userId, token: bodyText, phone: phoneRaw }, "WhatsApp onboarding token verified");
      return { kind: "token_verified", userId, phone: phoneRaw };
    }
    log.warn({ token: bodyText }, "WhatsApp token not found or expired");
    return { kind: "token_expired", phone: phoneRaw };
  }

  // ── 2. Require content ─────────────────────────────────────────────────────
  const hasMedia = parseInt(payload.numMedia ?? "0", 10) > 0;
  if (!bodyText && !hasMedia) {
    log.info({ sid: payload.messageSid }, "Empty message — skipping");
    return { kind: "empty_message" };
  }

  // ── 3. Deduplication ───────────────────────────────────────────────────────
  if (payload.messageSid) {
    const [existing] = await db
      .select({ id: inboxItemsTable.id })
      .from(inboxItemsTable)
      .where(eq(inboxItemsTable.twilio_message_sid, payload.messageSid))
      .limit(1);

    if (existing) {
      log.info({ sid: payload.messageSid }, "Duplicate MessageSid — skipping");
      return { kind: "duplicate", messageSid: payload.messageSid };
    }
  }

  // ── 4. Resolve household from sender phone ─────────────────────────────────
  // Member registrations take absolute priority over contact registrations.
  // All multi-household ambiguity is rejected (fail-closed) — no tie-breaking.
  // Duplicate phone registrations across households are possible (the contacts
  // API does not enforce cross-household uniqueness to avoid leaking tenant
  // presence). If a collision occurs, ingestion is discarded (multi_household).
  const resolved = await resolveHousehold(phoneNorm, log, phoneRaw);

  if (!resolved) {
    log.warn({ phone: phoneRaw }, "Unable to resolve sender to a unique household — discarding");
    return { kind: "multi_household", phone: phoneRaw };
  }

  const { householdId, matchedMembers, matchedContacts } = resolved;

  // ── 4.5. WhatsApp-native approval / dismiss / edit / undo ─────────────────
  // Security: only household ADMINS (role === "admin") may trigger approval
  // commands via WhatsApp. This enforces two boundaries:
  //   a) External contacts — even those with consent — cannot mutate pending
  //      household actions. They caused the inbox item but are not authorised
  //      to approve, dismiss, edit, or undo it.
  //   b) Non-admin household members share the household but are not designated
  //      decision-makers; restricting to admin prevents low-privilege members
  //      from approving financial, medical, or scheduling actions unilaterally.
  // This check runs before the consent check so consent status is irrelevant
  // to the authorization decision.
  //
  // Security: senderPhone is passed so the handler can look up the exact action
  // that was proposed to this sender (via wa-prompt-store), rather than picking
  // the most-recently-created pending action for the whole household. This closes
  // the race-condition approval hijack window.
  const senderIsAdmin = matchedMembers.some(
    (m) => m.household_id === householdId && m.role === "admin",
  );

  if (bodyText && senderIsAdmin) {
    const approvalOutcome = await handleApprovalResponse(bodyText, householdId, phoneRaw, log);
    if (approvalOutcome) {
      return { ...approvalOutcome, phone: phoneRaw };
    }
  }

  // ── 4.6. Consent reply handling (SIM / NÃO / REVOGAR from diaristas) ────────
  // This runs for all senders — members who are also contacts are rare, and the
  // approval handler above already short-circuits for admin commands.
  //
  // Security invariants:
  //   • We only update the contact row for the household that was resolved from
  //     this sender's phone, preventing cross-tenant consent mutations.
  //   • "SIM" / "NÃO" only apply when consent_status is "pending" — we do not
  //     let a stale "SIM" flip a "revoked" contact back to consented.
  //   • "REVOGAR" applies to both "pending" and "consented" contacts so a
  //     diarista can always withdraw at any time (LGPD requirement).
  if (bodyText) {
    const upper = bodyText.trim().toUpperCase();
    const contactForConsent = matchedContacts.find((c) => c.household_id === householdId);

    if (contactForConsent && (upper === "SIM" || upper === "NÃO" || upper === "NAO" || upper === "REVOGAR")) {
      const currentStatus = contactForConsent.consent_status;
      let newStatus: "consented" | "revoked" | null = null;

      if (upper === "SIM" && currentStatus === "pending") {
        newStatus = "consented";
      } else if ((upper === "NÃO" || upper === "NAO") && currentStatus === "pending") {
        newStatus = "revoked";
      } else if (upper === "REVOGAR" && (currentStatus === "pending" || currentStatus === "consented")) {
        newStatus = "revoked";
      }

      if (newStatus !== null) {
        const now = new Date();
        const twelveMonthsFromNow = new Date(now);
        twelveMonthsFromNow.setFullYear(twelveMonthsFromNow.getFullYear() + 1);

        // Idempotency guard: include the expected current status in the WHERE
        // clause so that a Twilio retry (or a SIM+REVOGAR race) that arrives
        // after the first update has already changed the status becomes a no-op
        // at the DB level rather than re-writing or flipping the value.
        // REVOGAR is valid from both "pending" and "consented", so we use OR.
        const statusGuard =
          upper === "REVOGAR"
            ? or(
                eq(contactsTable.consent_status, "pending"),
                eq(contactsTable.consent_status, "consented"),
              )
            : eq(contactsTable.consent_status, currentStatus!);

        await db
          .update(contactsTable)
          .set({
            consent_status: newStatus,
            ...(newStatus === "consented"
              ? { consent_granted_at: now, consent_check_in_due_at: twelveMonthsFromNow }
              : { consent_withdrawn_at: now, consent_check_in_due_at: null }),
          })
          .where(
            and(
              eq(contactsTable.id, contactForConsent.id),
              eq(contactsTable.household_id, householdId),
              statusGuard,
            ),
          );

        log.info(
          { contactId: contactForConsent.id, householdId, oldStatus: currentStatus, newStatus },
          "Contact consent status updated via WhatsApp reply",
        );

        return { kind: "consent_updated", contactId: contactForConsent.id, newStatus, phone: phoneRaw, householdId, contactName: contactForConsent.name };
      }
    }
  }

  // Prefer contact name, fall back to WA profile name
  let senderName: string | null = payload.profileName ?? null;
  let senderIsContact = false;
  let consentGranted = true;

  const contactMatch = matchedContacts.find((c) => c.household_id === householdId);
  if (contactMatch) {
    senderName = contactMatch.name;
    senderIsContact = true;
    consentGranted = contactMatch.consent_status === "granted";
    log.info(
      { contact: contactMatch.name, householdId, consent: contactMatch.consent_status },
      "Matched sender to contact",
    );
  } else {
    const memberMatch = matchedMembers.find((m) => m.household_id === householdId);
    if (memberMatch) {
      senderName = memberMatch.name;
      log.info({ member: memberMatch.name, householdId }, "Matched sender to member");
    }
  }

  // ── 5. Media processing ────────────────────────────────────────────────────
  // Rate-limit media downloads per sender to prevent resource exhaustion via
  // repeated large attachments driving memory allocation and paid AI API calls.
  let source = "whatsapp";
  let rawContent = bodyText;

  if (hasMedia && payload.mediaUrl && payload.mediaContentType) {
    if (!checkMediaRateLimit(phoneNorm)) {
      log.warn(
        { phone: phoneRaw, householdId },
        "Media rate limit exceeded for sender — skipping media processing",
      );
      return { kind: "media_rate_limited", phone: phoneRaw };
    }

    log.info(
      { contentType: payload.mediaContentType, sid: payload.messageSid },
      "Processing media attachment",
    );
    const processed = await processWhatsAppMedia(
      payload.mediaUrl,
      payload.mediaContentType,
      bodyText || undefined,
    );
    source = processed.source;
    rawContent = processed.rawContent;
  } else if (!rawContent) {
    rawContent = "(mídia recebida)";
  }

  // ── 6. Create inbox item ───────────────────────────────────────────────────
  const [item] = await db
    .insert(inboxItemsTable)
    .values({
      household_id: householdId,
      source,
      raw_content: rawContent,
      media_url: payload.mediaUrl ?? null,
      status: "classifying",
      sender_name: senderName,
      twilio_message_sid: payload.messageSid ?? null,
    })
    .returning();

  log.info(
    { inboxItemId: item.id, sender: senderName, householdId },
    "WhatsApp message ingested",
  );

  // ── 7. AI classification (async — response already sent to Twilio) ─────────
  await classifyAndSaveAction(item.id);
  log.info({ inboxItemId: item.id }, "Message classified");

  // ── 7.5. Post-classification pattern detection (fire-and-forget) ──────────
  // Runs after every successfully classified message so patterns are updated
  // in near-real-time rather than waiting for the 6-hour scheduled scan.
  // Errors here are non-fatal — the message was already ingested and classified.
  void detectPatternsForHousehold(householdId).catch((err) => {
    log.warn({ err, householdId }, "Post-classification pattern detection failed (non-fatal)");
  });

  // Read back the saved action to inform the caller's reply (proposal message)
  const [savedAction] = await db
    .select({
      id: suggestedActionsTable.id,
      approval_level: suggestedActionsTable.approval_level,
      title: suggestedActionsTable.title,
      type: suggestedActionsTable.type,
      category: suggestedActionsTable.category,
      datetime: suggestedActionsTable.datetime,
    })
    .from(suggestedActionsTable)
    .where(eq(suggestedActionsTable.inbox_item_id, item.id))
    .limit(1);

  // ── 8. Bind the proposed action to this sender's phone ────────────────────
  // Record the (phone → actionId) mapping now so that when the admin/sender
  // replies "sim"/"não", the approval handler operates on this exact action
  // rather than the most-recent pending action for the household.
  if (savedAction?.id && savedAction.title) {
    recordPrompt(phoneRaw, savedAction.id, householdId);
    log.info(
      { phone: phoneRaw, actionId: savedAction.id },
      "Bound proposed action to sender phone",
    );
  }

  return {
    kind: "ingested",
    inboxItemId: item.id,
    householdId,
    phone: phoneRaw,
    approvalLevel: savedAction?.approval_level ?? "one_tap",
    senderName,
    consentGranted: !senderIsContact || consentGranted,
    actionTitle: savedAction?.title ?? null,
    actionType: savedAction?.type ?? null,
    actionCategory: savedAction?.category ?? null,
    actionDatetime: savedAction?.datetime ?? null,
  };
}
