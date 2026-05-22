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

/**
 * Resolves the single owning household for a normalised phone number.
 *
 * Resolution priority (most → least authoritative):
 *   1. Member match — members are household-owned; a single-member match wins
 *      outright. If multiple households each have a member with this phone
 *      (extremely rare, e.g. someone re-registers), use the earliest created_at.
 *   2. Contact match — external contacts can be added by any household.
 *      If exactly one household registered this phone as a contact, it wins.
 *      If multiple households registered the same contact phone, the earliest
 *      created_at claim wins (tie-breaker removes the DoS incentive: a later
 *      registration cannot displace the original household's delivery).
 *
 * Returns `null` when no match exists at all.
 */
async function resolveHousehold(
  phoneNorm: string,
  log: Logger,
  phoneRaw: string,
): Promise<{ householdId: number; matchedMembers: MatchedMember[]; matchedContacts: MatchedContact[] } | null> {
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
      created_at: membersTable.created_at,
    })
    .from(membersTable);

  const matchedContacts = allContacts.filter(
    (c) => c.phone && normalisePhone(c.phone) === phoneNorm,
  );
  const matchedMembers = allMembers.filter(
    (m) => m.phone && normalisePhone(m.phone) === phoneNorm,
  );

  // ── Priority 1: member matches ─────────────────────────────────────────────
  if (matchedMembers.length > 0) {
    const memberHouseholds = new Set(matchedMembers.map((m) => m.household_id));
    if (memberHouseholds.size === 1) {
      return { householdId: [...memberHouseholds][0], matchedMembers, matchedContacts };
    }
    // Multiple households have a member with this phone — use oldest registration
    const sorted = [...matchedMembers].sort(
      (a, b) => a.created_at.getTime() - b.created_at.getTime(),
    );
    log.warn(
      { phone: phoneRaw, households: [...memberHouseholds], sid: undefined },
      "Phone matched multiple member households — routing to oldest claim",
    );
    return { householdId: sorted[0].household_id, matchedMembers, matchedContacts };
  }

  // ── Priority 2: contact matches ────────────────────────────────────────────
  if (matchedContacts.length === 0) {
    return null;
  }

  const contactHouseholds = new Set(matchedContacts.map((c) => c.household_id));
  if (contactHouseholds.size === 1) {
    return { householdId: [...contactHouseholds][0], matchedMembers, matchedContacts };
  }

  // Multiple households registered the same contact phone.
  // Route to the earliest claim so a later registration cannot create a DoS.
  const sorted = [...matchedContacts].sort(
    (a, b) => a.created_at.getTime() - b.created_at.getTime(),
  );
  log.warn(
    { phone: phoneRaw, households: [...contactHouseholds] },
    "Phone matched multiple contact households — routing to oldest claim to prevent cross-tenant DoS",
  );
  return { householdId: sorted[0].household_id, matchedMembers, matchedContacts };
}

type MatchedMember = {
  name: string;
  phone: string | null;
  household_id: number;
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
  // Uses priority-based resolution: members > contacts, oldest claim wins on ties.
  const resolved = await resolveHousehold(phoneNorm, log, phoneRaw);

  if (!resolved) {
    log.warn({ phone: phoneRaw }, "Unknown sender — discarding");
    return { kind: "unknown_sender", phone: phoneRaw };
  }

  const { householdId, matchedMembers, matchedContacts } = resolved;

  // ── 4.5. WhatsApp-native approval / dismiss / edit / undo ─────────────────
  // Only household MEMBERS may send approval commands. External contacts,
  // even those with consent, cannot mutate household actions via WhatsApp.
  // This prevents a third-party contact from approving, editing, or undoing
  // actions simply because their phone happens to be registered in the household.
  const senderIsMember = matchedMembers.some((m) => m.household_id === householdId);

  if (bodyText && senderIsMember) {
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
