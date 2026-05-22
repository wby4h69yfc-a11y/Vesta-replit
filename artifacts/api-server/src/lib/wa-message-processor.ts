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
import { eq } from "drizzle-orm";
import { classifyAndSaveAction } from "./classifier";
import { processWhatsAppMedia } from "./media-analysis";
import { looksLikeToken, markTokenVerified } from "./wa-token-store";
import { handleApprovalResponse } from "./wa-approval-handler";

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
  | { kind: "approved_via_wa"; actionId: number; actionTitle: string; householdId: number; phone: string }
  | { kind: "dismissed_via_wa"; actionId: number; householdId: number; phone: string }
  | { kind: "edited_via_wa"; actionId: number; newTitle: string; householdId: number; phone: string }
  | { kind: "undone_via_wa"; actionTitle: string; householdId: number; phone: string }
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
 * Resolution rules:
 *
 * 1. Member matches take absolute priority over contact matches.
 *    Members are household-owned records (added by admins); contacts are
 *    externally-sourced and can be added with arbitrary phone numbers by any
 *    authenticated user. A contact registration in Household B CANNOT displace
 *    or block a member registration in Household A.
 *
 *    - Exactly one household has a member with this phone → route there.
 *    - Multiple member households (rare edge case) → use oldest created_at as
 *      a deterministic tie-breaker and warn.
 *
 * 2. If no member matches exist, fall back to contact matches.
 *    - Exactly one household has a contact with this phone → route there.
 *    - Multiple contact households → return null (unresolvable, discard).
 *      Routing ambiguous contact phones risks cross-tenant misdelivery, so we
 *      prefer safe rejection over uncertain delivery. The collision is logged
 *      as a warning so operators can investigate.
 *
 * Returns null when no match exists or when contact-only resolution is
 * ambiguous (caller should return unknown_sender / multi_household).
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

  // ── Priority 1: member matches — authoritative, always wins over contacts ──
  if (matchedMembers.length > 0) {
    const memberHouseholdIds = new Set(matchedMembers.map((m) => m.household_id));

    if (memberHouseholdIds.size === 1) {
      return { householdId: [...memberHouseholdIds][0], matchedMembers, matchedContacts };
    }

    // Multiple households each have a member with this phone (extremely rare —
    // e.g. re-used number after household restructuring). Use oldest registration
    // as a deterministic, stable tie-breaker.
    const sorted = [...matchedMembers].sort(
      (a, b) => a.created_at.getTime() - b.created_at.getTime(),
    );
    log.warn(
      { phone: phoneRaw, households: [...memberHouseholdIds] },
      "Phone matched multiple member households — routing to oldest registration",
    );
    return { householdId: sorted[0].household_id, matchedMembers, matchedContacts };
  }

  // ── Priority 2: contact-only matches ──────────────────────────────────────
  if (matchedContacts.length === 0) {
    return null; // truly unknown sender
  }

  const contactHouseholdIds = new Set(matchedContacts.map((c) => c.household_id));

  if (contactHouseholdIds.size === 1) {
    return { householdId: [...contactHouseholdIds][0], matchedMembers, matchedContacts };
  }

  // Multiple households registered the same contact phone with no member-based
  // ownership. Routing arbitrarily risks misdelivering sensitive messages to the
  // wrong household. Discard and warn so operators can investigate the collision.
  log.warn(
    { phone: phoneRaw, households: [...contactHouseholdIds] },
    "Phone matched multiple contact households with no member ownership — discarding to prevent cross-tenant misdelivery",
  );
  return null; // caller will return multi_household
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
  // Member registrations take absolute priority over contact registrations so
  // that a contact entry in a different household cannot hijack or block
  // delivery to the legitimate member's household.
  // Contact-only collisions across households are discarded (no routing guess).
  const resolved = await resolveHousehold(phoneNorm, log, phoneRaw);

  if (!resolved) {
    // Distinguish "never seen before" from "ambiguous across households" only
    // in logging — the external behaviour is the same: no reply, no delivery.
    log.warn({ phone: phoneRaw }, "Unable to resolve sender to a single household — discarding");
    // Return multi_household so the webhook switch falls into its no-reply branch.
    return { kind: "multi_household", phone: phoneRaw };
  }

  const { householdId, matchedMembers, matchedContacts } = resolved;

  // ── 4.5. WhatsApp-native approval / dismiss / edit / undo ─────────────────
  // Security: only household admins may send approval commands via WhatsApp.
  //
  // Rationale:
  //   • Contacts (external senders) must never control household actions —
  //     they triggered the inbox item but are not authorised to approve it.
  //   • Non-admin members can view the household but admins are the designated
  //     decision-makers; restricting to admin role prevents a shared-device or
  //     low-privilege member from approving financial, medical, or scheduling
  //     actions without the admin's knowledge.
  //   • This check is intentionally enforced before the consent check below so
  //     that an external contact with consent still cannot issue commands.
  const senderIsAdmin = matchedMembers.some(
    (m) => m.household_id === householdId && m.role === "admin",
  );

  if (bodyText && senderIsAdmin) {
    const approvalOutcome = await handleApprovalResponse(bodyText, householdId, log);
    if (approvalOutcome) {
      return { ...approvalOutcome, phone: phoneRaw };
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
  let source = "whatsapp";
  let rawContent = bodyText;

  if (hasMedia && payload.mediaUrl && payload.mediaContentType) {
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

  // Read back the saved action to inform the caller's reply (proposal message)
  const [savedAction] = await db
    .select({
      approval_level: suggestedActionsTable.approval_level,
      title: suggestedActionsTable.title,
      type: suggestedActionsTable.type,
      category: suggestedActionsTable.category,
      datetime: suggestedActionsTable.datetime,
    })
    .from(suggestedActionsTable)
    .where(eq(suggestedActionsTable.inbox_item_id, item.id))
    .limit(1);

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
