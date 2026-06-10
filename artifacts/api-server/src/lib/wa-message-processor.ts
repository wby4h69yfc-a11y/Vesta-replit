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

import crypto from "crypto";
import type { Logger } from "pino";
import { db } from "@workspace/db";
import {
  inboxItemsTable,
  contactsTable,
  membersTable,
  suggestedActionsTable,
  proactiveMessageQueueTable,
  waConversationsTable,
  auditLogTable,
  waMediaRateLimitsTable,
  memberInvitesTable,
} from "@workspace/db";
import { applyContactRating } from "./provider-rating";
import type { RatingKeyword } from "./provider-rating";
import { eq, and, or, sql, desc } from "drizzle-orm";
import { classifyAndSaveAction } from "./classifier";
import { processWhatsAppMedia } from "./media-analysis";
import { looksLikeToken, markTokenVerified } from "./wa-token-store";
import { handleWaOnboarding } from "./wa-onboarding-handler";
import { handleApprovalResponse } from "./wa-approval-handler";
import { recordPrompt } from "./wa-prompt-store";
import { detectPatternsForHousehold } from "./pattern-detector";
import { isConsentActive } from "./whatsapp";
import { handleQuestionIntent, isMutationCommand } from "./wa-qa-handler";
import { clearQaSession } from "./wa-qa-session-store";
import { handleMutationIntent, executeConfirmedMutation } from "./wa-mutation-handler";
import type { MutationProposedPayload } from "./wa-mutation-handler";
import { isCalendarQuery, handleCalendarQueryIntent } from "./wa-calendar-query-handler";
import {
  isReminderIntent,
  isCancelReminderIntent,
  handleSetReminderIntent,
  handleCancelReminderIntent,
  handleReminderQuietConfirm,
} from "./wa-reminder-handler";

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
  /**
   * Group JID when the message originated from a WhatsApp group chat (Twilio
   * sets WaGroupId for group messages). Null/undefined for direct messages.
   * When present, the webhook has already stripped the /vesta prefix from body.
   */
  groupId?: string | null;
}

export type ProcessOutcome =
  | { kind: "token_verified"; userId: string; phone: string }
  | { kind: "token_expired"; phone: string }
  | { kind: "empty_message" }
  | { kind: "duplicate"; messageSid: string }
  | { kind: "unknown_sender"; phone: string }
  | { kind: "multi_household"; phone: string }
  /** New-user WhatsApp-native onboarding — reply contains the next prompt. */
  | { kind: "wa_onboarding"; phone: string; reply: string }
  | { kind: "media_rate_limited"; phone: string }
  | { kind: "approved_via_wa"; actionId: number; actionTitle: string; householdId: number; phone: string }
  | { kind: "dismissed_via_wa"; actionId: number; householdId: number; phone: string }
  | { kind: "nl_edit_proposed_via_wa"; actionId: number; newTitle: string; householdId: number; phone: string }
  | { kind: "edit_prompt_via_wa"; actionId: number; householdId: number; phone: string }
  | { kind: "undone_via_wa"; actionTitle: string; householdId: number; phone: string }
  | { kind: "consent_updated"; contactId: number; newStatus: "consented" | "revoked"; phone: string; householdId: number; contactName: string }
  | {
      kind: "provider_rated";
      contactId: number;
      contactName: string;
      rating: RatingKeyword;
      reliabilityStatus: string;
      noShowCount: number;
      suggestUpgrade: boolean;
      suggestAvoid: boolean;
      householdId: number;
      phone: string;
    }
  | { kind: "avoid_confirmed"; contactId: number; contactName: string; householdId: number; phone: string }
  | { kind: "avoid_cancelled"; contactId: number; contactName: string; householdId: number; phone: string }
  | { kind: "promoted_to_preferred"; contactId: number; contactName: string; householdId: number; phone: string }
  | { kind: "suggest_preferred_declined"; contactId: number; contactName: string; householdId: number; phone: string }
  | { kind: "question_answered"; reply: string; householdId: number; phone: string }
  /** A DM mutation command was parsed and a proposal was sent — waiting for sim/não. */
  | { kind: "mutation_proposed_via_wa"; proposal: string; householdId: number; phone: string }
  /** Admin confirmed a pending mutation proposal — the action was executed. */
  | { kind: "mutation_executed_via_wa"; description: string; householdId: number; phone: string }
  /** Admin declined a pending mutation proposal. */
  | { kind: "mutation_dismissed_via_wa"; householdId: number; phone: string }
  /** Mutation command received but the handler could not parse or resolve it. */
  | { kind: "mutation_error_via_wa"; reply: string; householdId: number; phone: string }
  /** A /vesta group command arrived from a non-admin household member. */
  | { kind: "group_non_admin"; phone: string; groupId: string }
  /** A mutation command (cancela, cria, apaga…) arrived from a group chat. */
  | { kind: "group_mutation_blocked"; phone: string; groupId: string }
  /**
   * A voice message was transcribed but Whisper confidence was below 0.70.
   * An interactive Sim/Não confirmation has been queued to the sender.
   * preview = first 100 chars of the transcript shown to the user.
   */
  | { kind: "voice_confirm_pending"; inboxItemId: number; householdId: number; phone: string; preview: string }
  /**
   * The sender replied "não" to a voice transcript confirmation.
   * The inbox item has been set to "dismissed".
   */
  | { kind: "voice_confirm_dismissed"; householdId: number; phone: string }
  | {
      kind: "ingested";
      inboxItemId: number;
      householdId: number;
      phone: string;
      approvalLevel: string;
      senderName: string | null;
      consentGranted: boolean;
      actionId: number | null;
      actionTitle: string | null;
      actionType: string | null;
      actionCategory: string | null;
      actionDatetime: string | null;
      /** Classification confidence — used by the WA-native routing decision */
      confidence: number;
      /** True when the message spans multiple intents or involves a payment */
      cascadeCheckNeeded: boolean;
      workflowTags: string[];
      /**
       * True when the action was bound in wa_conversations and can be approved
       * directly in WhatsApp. False means the item must be reviewed in the app.
       * This is authoritative — do not re-compute in webhook.ts.
       */
      waCanApproveViaWa: boolean;
    };

/** Strip all non-digit chars for exact phone matching. */
function normalisePhone(p: string): string {
  return p.replace(/\D/g, "");
}

// ── "Adicionar membro" WA admin command ───────────────────────────────────────

/** Matches "Adicionar membro [nome]" and close variants (case-insensitive). */
function isAddMemberCommand(text: string): boolean {
  return /adicionar?\s+(?:membro|co-?respons[aá]vel|parceiro|familiar)/i.test(text.trim());
}

/** Extracts an optional name from "Adicionar membro [nome]". */
function extractAddMemberName(text: string): string | null {
  const m = text.match(/adicionar?\s+(?:membro|co-?respons[aá]vel|parceiro|familiar)\s+(.+)/i);
  return m?.[1]?.trim() ?? null;
}

/** Generates a 6-char alphanumeric invite token that always contains ≥1 letter. */
function genInviteToken(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = crypto.randomBytes(6);
  const suffix = Array.from(bytes, b => chars[b % chars.length]);
  if (!suffix.some(c => letters.includes(c))) {
    suffix[0] = letters[crypto.randomBytes(1)[0] % letters.length];
  }
  return `VESTA-${suffix.join("")}`;
}

/**
 * Handles "Adicionar membro [nome]" admin DM command.
 * Finds unlinked adult members, generates an invite token, and returns
 * a reply string the caller can forward directly to the invitee.
 */
async function handleAddMemberInviteCommand(
  bodyText: string,
  householdId: number,
  log: Logger,
): Promise<string> {
  const requestedName = extractAddMemberName(bodyText);
  const waNumber = process.env.TWILIO_WHATSAPP_FROM ?? process.env.DIALOG360_WHATSAPP_NUMBER ?? null;
  const waDisplay = waNumber ? `+${waNumber.replace(/\D/g, "")}` : "o número do Vesta";

  // Fetch all adult members without a linked WA phone.
  const unlinked = await db
    .select({ id: membersTable.id, name: membersTable.name })
    .from(membersTable)
    .where(
      and(
        eq(membersTable.household_id, householdId),
        eq(membersTable.relationship_type, "adult"),
        sql`${membersTable.phone} IS NULL`,
      ),
    );

  if (unlinked.length === 0) {
    return "✅ Todos os adultos da família já têm WhatsApp vinculado ao Vesta.";
  }

  // If no name given, list available members.
  if (!requestedName) {
    const list = unlinked.map(m => `• ${m.name}`).join("\n");
    return (
      "👥 Membros disponíveis para convidar (sem WhatsApp vinculado):\n\n" +
      list +
      "\n\nResponda:\n_Adicionar membro [nome]_\n\nExemplo: Adicionar membro Maria"
    );
  }

  // Find member by name (case-insensitive fuzzy match).
  const lower = requestedName.toLowerCase();
  const matches = unlinked.filter(m => m.name.toLowerCase().includes(lower));

  if (matches.length === 0) {
    const list = unlinked.map(m => `• ${m.name}`).join("\n");
    return (
      `⚠️ Não encontrei um membro sem WhatsApp com o nome "${requestedName}".\n\n` +
      `Membros disponíveis:\n${list}`
    );
  }

  if (matches.length > 1) {
    const list = matches.map(m => `• ${m.name}`).join("\n");
    return (
      `⚠️ Encontrei mais de um membro com "${requestedName}":\n${list}\n\nSeja mais específico no nome.`
    );
  }

  const member = matches[0];

  // Generate invite token and store it (replace any pending unused invite for this member).
  const token = genInviteToken();
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

  await db
    .delete(memberInvitesTable)
    .where(and(eq(memberInvitesTable.member_id, member.id), sql`${memberInvitesTable.used_at} IS NULL`));

  await db.insert(memberInvitesTable).values({
    household_id: householdId,
    member_id: member.id,
    token,
    expires_at: expiresAt,
  });

  log.info({ memberId: member.id, householdId, tokenPrefix: token.slice(0, 9) }, "wa-invite: token generated via WA command");

  const inviteText =
    `Olá, *${member.name}*! Você foi convidado(a) para o Vesta — assistente de logística da família.\n\n` +
    `Para vincular seu WhatsApp, envie a mensagem abaixo para ${waDisplay}:\n\n` +
    `*${token}*\n\n` +
    `_(Este código expira em 48 horas)_`;

  return (
    `✅ Convite gerado para *${member.name}*!\n\n` +
    `Encaminhe a mensagem abaixo:\n\n` +
    `───────────────\n` +
    inviteText +
    `\n───────────────`
  );
}

// ── Per-sender media rate limiting (DB-backed) ────────────────────────────────
// Limits unbounded media download + AI processing to at most MEDIA_RATE_LIMIT
// messages per hour per sender.  The counter is stored in PostgreSQL so all
// autoscaled instances share the same window — an in-process Map would only
// enforce the limit per-instance and allow senders to exceed the cap by
// hitting different workers.
//
// A single atomic upsert (INSERT … ON CONFLICT DO UPDATE) increments the
// counter or resets it when the 1-hour window has expired, so no two instances
// can race to double-count or double-reset.

const MEDIA_RATE_LIMIT = 10;

async function checkMediaRateLimit(phoneNorm: string): Promise<boolean> {
  const [row] = await db
    .insert(waMediaRateLimitsTable)
    .values({ phone_norm: phoneNorm, count: 1, window_start: new Date() })
    .onConflictDoUpdate({
      target: waMediaRateLimitsTable.phone_norm,
      set: {
        count: sql`CASE WHEN NOW() - ${waMediaRateLimitsTable.window_start} > INTERVAL '1 hour' THEN 1 ELSE ${waMediaRateLimitsTable.count} + 1 END`,
        window_start: sql`CASE WHEN NOW() - ${waMediaRateLimitsTable.window_start} > INTERVAL '1 hour' THEN NOW() ELSE ${waMediaRateLimitsTable.window_start} END`,
      },
    })
    .returning({ count: waMediaRateLimitsTable.count });

  return (row?.count ?? 1) <= MEDIA_RATE_LIMIT;
}

// ── Voice transcript confirmation regexes ────────────────────────────────────
// Kept intentionally short — we only confirm the two most unambiguous intents.
// Any other message from a sender with an open voice_confirm conversation falls
// through to normal ingestion, keeping the conversation open until it expires.
const VOICE_CONFIRM_SIM_RE =
  /^(sim|s|ok|pode|confirmar|aceito|vai|tá|ta|bom|beleza|feito|claro|combinado)[\s!.]*$/i;
const VOICE_CONFIRM_NAO_RE =
  /^(não|nao|n|não\s+quero|nao\s+quero)[\s!.]*$/i;

const VOICE_CONFIRM_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Checks whether the inbound `bodyText` is a Sim/Não response to an open
 * voice-transcript confirmation conversation.
 *
 * Called before the standard approval handler so that a "sim" from any
 * verified sender is correctly routed even when the sender is not an admin.
 *
 * Returns:
 *   - A full ProcessOutcome when the response is handled.
 *   - undefined when there is no open voice_confirm conversation or the
 *     body does not match sim/não (caller continues with normal flow).
 */
async function handleVoiceConfirmResponse(
  bodyText: string,
  householdId: number,
  phoneRaw: string,
  log: Logger,
): Promise<ProcessOutcome | undefined> {
  const trimmed = bodyText.trim();
  const isSim = VOICE_CONFIRM_SIM_RE.test(trimmed);
  const isNao = VOICE_CONFIRM_NAO_RE.test(trimmed);

  if (!isSim && !isNao) return undefined;

  const now = new Date();
  const phoneNorm = normalisePhone(phoneRaw);

  const [conv] = await db
    .select()
    .from(waConversationsTable)
    .where(
      and(
        eq(waConversationsTable.household_id, householdId),
        eq(waConversationsTable.sender_phone, phoneNorm),
        eq(waConversationsTable.thread_context, "voice_confirm"),
        eq(waConversationsTable.state, "awaiting_confirmation"),
        sql`${waConversationsTable.expires_at} > NOW()`,
      ),
    )
    .orderBy(desc(waConversationsTable.created_at))
    .limit(1);

  if (!conv) return undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload = conv.proposed_payload as any;
  const inboxItemId = payload?.inbox_item_id as number | undefined;

  if (!inboxItemId) {
    log.warn({ convId: conv.id }, "voice-confirm: missing inbox_item_id — skipping");
    return undefined;
  }

  if (isNao) {
    await db
      .update(waConversationsTable)
      .set({ state: "dismissed", last_message_at: now })
      .where(eq(waConversationsTable.id, conv.id));

    await db
      .update(inboxItemsTable)
      .set({ status: "dismissed", updated_at: now })
      .where(
        and(
          eq(inboxItemsTable.id, inboxItemId),
          eq(inboxItemsTable.household_id, householdId),
        ),
      );

    log.info(
      { inboxItemId, householdId },
      "voice-confirm: sender dismissed transcript — inbox item abandoned",
    );
    return { kind: "voice_confirm_dismissed", householdId, phone: phoneRaw };
  }

  // "sim" — resume classification pipeline

  // Derive real consent state for this sender.
  // The voice_confirm conversation was only opened for active-consent senders,
  // but consent may have changed between voice receipt and this "sim" reply.
  // We re-check here so the returned ingested outcome carries an accurate
  // consentGranted value that webhook.ts uses to suppress WA replies if needed.
  const [senderContact] = await db
    .select({
      consent_status: contactsTable.consent_status,
      consent_check_in_due_at: contactsTable.consent_check_in_due_at,
    })
    .from(contactsTable)
    .where(
      and(
        eq(contactsTable.household_id, householdId),
        sql`regexp_replace(${contactsTable.phone}, '\\D', '', 'g') = ${phoneNorm}`,
      ),
    )
    .limit(1);

  const simSenderIsContact = senderContact !== undefined;
  const simConsentGranted = !simSenderIsContact || isConsentActive(senderContact);

  // 1. Move inbox item to "classifying" so the classifier picks it up.
  await db
    .update(inboxItemsTable)
    .set({ status: "classifying", updated_at: now })
    .where(
      and(
        eq(inboxItemsTable.id, inboxItemId),
        eq(inboxItemsTable.household_id, householdId),
      ),
    );

  // 2. Classify and save the suggested action.
  await classifyAndSaveAction(inboxItemId);
  log.info({ inboxItemId }, "voice-confirm: classification resumed after sender confirmation");

  // 3. Fire-and-forget pattern detection.
  void detectPatternsForHousehold(householdId).catch((err) => {
    log.warn({ err, householdId }, "voice-confirm: post-classification pattern detection failed (non-fatal)");
  });

  // 4. Close the voice_confirm conversation.
  await db
    .update(waConversationsTable)
    .set({ state: "completed", last_message_at: now })
    .where(eq(waConversationsTable.id, conv.id));

  // 5. Read back the saved action.
  const [savedAction] = await db
    .select({
      id: suggestedActionsTable.id,
      approval_level: suggestedActionsTable.approval_level,
      title: suggestedActionsTable.title,
      type: suggestedActionsTable.type,
      category: suggestedActionsTable.category,
      datetime: suggestedActionsTable.datetime,
      confidence: suggestedActionsTable.confidence,
      cascade_check_needed: suggestedActionsTable.cascade_check_needed,
      workflow_tags: suggestedActionsTable.workflow_tags,
    })
    .from(suggestedActionsTable)
    .where(eq(suggestedActionsTable.inbox_item_id, inboxItemId))
    .limit(1);

  // 6. Read sender name from the stored inbox item.
  const [storedItem] = await db
    .select({ sender_name: inboxItemsTable.sender_name })
    .from(inboxItemsTable)
    .where(eq(inboxItemsTable.id, inboxItemId))
    .limit(1);

  // 7. WA-native eligibility (same criteria as normal ingestion).
  const waEligible =
    savedAction !== undefined &&
    (savedAction.confidence ?? 0) >= 0.80 &&
    !(savedAction.cascade_check_needed ?? false) &&
    !(savedAction.workflow_tags ?? []).includes("payment_admin") &&
    (savedAction.approval_level ?? "one_tap") !== "explicit";

  if (waEligible && savedAction.id && savedAction.title) {
    await recordPrompt(
      phoneRaw,
      savedAction.id,
      householdId,
      {
        title: savedAction.title,
        type: savedAction.type,
        category: savedAction.category,
        datetime: savedAction.datetime ?? null,
      },
    );
    log.info(
      { phone: phoneRaw, actionId: savedAction.id },
      "voice-confirm: bound confirmed action to WA prompt — WA-native eligible",
    );
  }

  return {
    kind: "ingested",
    inboxItemId,
    householdId,
    phone: phoneRaw,
    approvalLevel: savedAction?.approval_level ?? "one_tap",
    senderName: storedItem?.sender_name ?? null,
    consentGranted: simConsentGranted,
    actionId: savedAction?.id ?? null,
    actionTitle: savedAction?.title ?? null,
    actionType: savedAction?.type ?? null,
    actionCategory: savedAction?.category ?? null,
    actionDatetime: savedAction?.datetime ?? null,
    confidence: savedAction?.confidence ?? 0.55,
    cascadeCheckNeeded: savedAction?.cascade_check_needed ?? false,
    workflowTags: savedAction?.workflow_tags ?? [],
    waCanApproveViaWa: waEligible,
  };
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
  consent_check_in_due_at: Date | null;
  created_at: Date;
};

type ResolvedHousehold = {
  kind: "found";
  householdId: number;
  matchedMembers: MatchedMember[];
  matchedContacts: MatchedContact[];
} | {
  kind: "unknown";
} | {
  kind: "multi_household";
};

/**
 * Resolves the single owning household for a normalised phone number.
 *
 * Resolution rules (strict, fail-closed):
 *
 * Member and contact matches are treated as equals in the household-resolution
 * pool. A phone that appears in ANY combination of member or contact records
 * across more than one household is ambiguous and is discarded.
 *
 * - Exactly one household matches the phone (via member and/or contact records)
 *   → route there.
 * - Zero households match → unknown sender (return null).
 * - More than one household matches → unresolvable (fail-closed, return null).
 *
 * Member matches never override contact matches from other households.
 * Giving members absolute priority would let an attacker with admin access to
 * their own household claim an arbitrary phone number as a member and silently
 * hijack inbound messages that legitimately belong to another household's
 * contact. Treating both sources equally prevents that attack: if the phone
 * is already registered as a contact in household B, adding it as a member in
 * household A produces a two-household collision and the message is discarded.
 *
 * The data entry layer enforces cross-household phone uniqueness for both
 * members and contacts, so the fail-closed path here should only be reached
 * for legacy data that predates that constraint.
 *
 * Returns null when no match exists or when resolution is ambiguous.
 */
async function resolveHousehold(
  phoneNorm: string,
  log: Logger,
  phoneRaw: string,
): Promise<ResolvedHousehold> {
  const allContacts = await db
    .select({
      id: contactsTable.id,
      name: contactsTable.name,
      phone: contactsTable.phone,
      household_id: contactsTable.household_id,
      consent_status: contactsTable.consent_status,
      consent_check_in_due_at: contactsTable.consent_check_in_due_at,
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

  // ── Merge member and contact households into one pool ─────────────────────
  // Both sources have equal weight. A phone registered as a member in
  // household A and a contact in household B produces a collision just as
  // two contact registrations would.
  const allMatchingHouseholdIds = new Set([
    ...matchedMembers.map((m) => m.household_id),
    ...matchedContacts.map((c) => c.household_id),
  ]);

  if (allMatchingHouseholdIds.size === 0) {
    return { kind: "unknown" }; // truly unknown sender — route to onboarding
  }

  if (allMatchingHouseholdIds.size === 1) {
    const householdId = [...allMatchingHouseholdIds][0]!;
    return { kind: "found", householdId, matchedMembers, matchedContacts };
  }

  // Multiple households claim this phone via any combination of member/contact
  // records. Fail-closed: no routing guess, no tie-breaker.
  log.warn(
    { phone: phoneRaw, households: [...allMatchingHouseholdIds] },
    "Phone matched multiple households (members and/or contacts) — discarding to prevent cross-tenant misdelivery",
  );
  return { kind: "multi_household" };
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
      log.info({ userId, phone: phoneRaw }, "WhatsApp onboarding token verified");
      return { kind: "token_verified", userId, phone: phoneRaw };
    }
    log.warn({ phone: phoneRaw }, "WhatsApp token not found or expired");
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
  // Member and contact phone matches have equal weight. Any collision across
  // households (member vs member, contact vs contact, or member vs contact)
  // is rejected fail-closed (multi_household). The data entry layer enforces
  // cross-household phone uniqueness for both members and contacts, so this
  // path is reached only for legacy data predating that constraint.
  const resolved = await resolveHousehold(phoneNorm, log, phoneRaw);

  if (resolved.kind === "unknown") {
    // Phone not registered in any household — route to WhatsApp-native onboarding.
    // Group messages are excluded: onboarding is a 1:1 DM flow only.
    if (payload.groupId) {
      log.info({ phone: phoneRaw }, "Unknown sender in group — silently ignoring");
      return { kind: "unknown_sender", phone: phoneRaw };
    }
    log.info({ phone: phoneRaw }, "Unknown sender — routing to WA onboarding");
    return await handleWaOnboarding(phoneRaw, bodyText, log);
  }

  if (resolved.kind === "multi_household") {
    log.warn({ phone: phoneRaw }, "Multi-household collision — discarding");
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

  // ── Group non-admin gate ───────────────────────────────────────────────────
  // For /vesta group commands, only household admins may invoke Vesta.
  // Return a specific outcome so the webhook sends the rejection reply
  // back into the group thread rather than silently ignoring the command.
  // Unknown senders never reach here (resolveHousehold already returned null).
  if (payload.groupId && !senderIsAdmin) {
    log.info(
      { phone: phoneRaw, groupId: payload.groupId, householdId, source: "group" },
      "Group /vesta command from non-admin sender — rejecting with group reply",
    );
    return { kind: "group_non_admin", phone: phoneRaw, groupId: payload.groupId };
  }

  // ── Group mutation gate ────────────────────────────────────────────────────
  // Write commands (cancela, cria, apaga, …) must be issued in a private DM
  // where Vesta can run the full approval loop. In a shared group thread the
  // multi-turn flow is unsafe: bystanders could read the proposal, and a
  // confused "sim" from any member could accidentally confirm the action.
  // We block mutation commands at this layer — before the approval handler or
  // Q&A handler — and send a clear "use DM for that" reply into the group so
  // the admin knows exactly what to do next.
  if (payload.groupId && bodyText && isMutationCommand(bodyText)) {
    log.info(
      { phone: phoneRaw, groupId: payload.groupId, householdId, preview: bodyText.substring(0, 60) },
      "Group /vesta mutation command blocked — must be sent in a direct message",
    );
    return { kind: "group_mutation_blocked", phone: phoneRaw, groupId: payload.groupId };
  }

  // Tag remaining log lines with group context when applicable.
  if (payload.groupId) {
    log.info(
      { groupId: payload.groupId, householdId, source: "group" },
      "Group /vesta command from admin — processing",
    );
  }

  // When the household admin sends ANY inbound message, mark pending proactive
  // rows as user_replied so the unread-backlog suppression (≥2 unread) clears.
  // This is the only place that sets user_replied=true — without it, suppression
  // becomes permanent after 2 sends.
  if (senderIsAdmin) {
    await db
      .update(proactiveMessageQueueTable)
      .set({ user_replied: true })
      .where(
        and(
          eq(proactiveMessageQueueTable.household_id, householdId),
          eq(proactiveMessageQueueTable.status, "sent"),
          eq(proactiveMessageQueueTable.user_replied, false),
        ),
      );
  }

  // ── 4.5a. Mutation proposal confirmation (SIM / NÃO) ─────────────────────
  // When the admin has an open mutation_confirm conversation (created by
  // section 4.59 below) and replies SIM/NÃO, execute or dismiss the pending
  // mutation.
  //
  // PRIORITY: This MUST run BEFORE handleApprovalResponse (4.5b). If both a
  // pending suggested action and a mutation proposal exist simultaneously,
  // the mutation confirmation takes priority because:
  //   a) Mutations are explicitly addressed commands, more destructive, and
  //      less recoverable than approving a suggested action.
  //   b) The admin just issued the mutation command, so it is most recent.
  //   c) Approving a suggested action unexpectedly when the admin was
  //      confirming a mutation cancellation is a worse UX error than
  //      deferring an action approval by one turn.
  //
  // Security: scoped by household_id AND sender_phone so two admins in the same
  // household cannot accidentally confirm each other's pending mutations.
  if (bodyText && senderIsAdmin) {
    const upper = bodyText.trim().toUpperCase();
    if (upper === "SIM" || upper === "NÃO" || upper === "NAO") {
      const [mutConv] = await db
        .select()
        .from(waConversationsTable)
        .where(
          and(
            eq(waConversationsTable.household_id, householdId),
            eq(waConversationsTable.sender_phone, normalisePhone(phoneRaw)),
            eq(waConversationsTable.thread_context, "mutation_confirm"),
            eq(waConversationsTable.state, "awaiting_confirmation"),
            sql`${waConversationsTable.expires_at} > NOW()`,
          ),
        )
        .orderBy(desc(waConversationsTable.created_at))
        .limit(1);

      if (mutConv) {
        // Clear the Q&A session — admin is now in a mutation flow
        void clearQaSession(phoneRaw, householdId);

        if (upper === "NÃO" || upper === "NAO") {
          await db
            .update(waConversationsTable)
            .set({ state: "dismissed", last_message_at: new Date() })
            .where(eq(waConversationsTable.id, mutConv.id));

          log.info(
            { householdId, convId: mutConv.id },
            "wa-mutation: admin dismissed pending mutation proposal",
          );
          return { kind: "mutation_dismissed_via_wa", householdId, phone: phoneRaw };
        }

        // "SIM" — execute the confirmed mutation
        const mutPayload = mutConv.proposed_payload as unknown as MutationProposedPayload | null;
        if (mutPayload) {
          const result = await executeConfirmedMutation(
            mutConv.id,
            mutPayload,
            householdId,
            phoneRaw,
            log,
          );
          if (result) {
            return {
              kind: "mutation_executed_via_wa",
              description: result.description,
              householdId,
              phone: phoneRaw,
            };
          }
          // Execution failed — send an error reply rather than silently falling through
          return {
            kind: "mutation_error_via_wa",
            reply: "⚠️ Não consegui executar essa ação. Tente novamente ou use o app.",
            householdId,
            phone: phoneRaw,
          };
        }
      }
    }
  }

  // ── 4.5a-1. Reminder quiet-hour confirmation (SIM / NÃO) ─────────────────
  // When a reminder was blocked by quiet hours and the user is replying to the
  // reschedule prompt ("reagendar para 07h?"), handle that before the standard
  // mutation/approval checks so we don't misinterpret "sim" as an action approval.
  // Any verified household member (not just admins) can set reminders.
  if (bodyText) {
    const reminderQuietReply = await handleReminderQuietConfirm(
      bodyText,
      householdId,
      phoneRaw,
      log,
    );
    if (reminderQuietReply !== undefined) {
      log.info(
        { householdId, phone: phoneRaw },
        "wa-reminder: handled quiet-hour reschedule reply",
      );
      return { kind: "question_answered", reply: reminderQuietReply, householdId, phone: phoneRaw };
    }
  }

  // ── 4.5b. WhatsApp-native approval / dismiss / edit / undo ────────────────
  if (bodyText && senderIsAdmin) {
    const approvalOutcome = await handleApprovalResponse(bodyText, householdId, phoneRaw, log);
    if (approvalOutcome) {
      // Admin is engaging with an approval flow — clear any stale Q&A session
      void clearQaSession(phoneRaw, householdId);
      return { ...approvalOutcome, phone: phoneRaw };
    }
  }

  // ── 4.5c. Voice transcript confirmation (sim / não from any verified sender) ─
  // Intercepts "sim"/"não" responses that belong to an open voice_confirm
  // conversation created when a low-confidence voice message arrived.
  // Runs after the mutation confirm (4.5a) and standard approval handler (4.5b)
  // so that explicit action proposals take priority over pending voice confirms.
  // Not gated on senderIsAdmin — voice messages can come from any household member.
  if (bodyText) {
    const voiceOutcome = await handleVoiceConfirmResponse(bodyText, householdId, phoneRaw, log);
    if (voiceOutcome) return voiceOutcome;
  }

  // ── 4.55. Provider rating reply (BOM / OK / RUIM / NÃO APARECEU) ─────────
  // Only admin senders can rate providers (same privilege as action approval).
  // We check for an open wa_conversations row with thread_context='rating_request'
  // so that arbitrary messages from the admin don't accidentally trigger a rating.
  // The rating conversation expires after 24 hours.
  if (bodyText && senderIsAdmin) {
    const upper = bodyText.trim().toUpperCase();
    const ratingMap: Record<string, RatingKeyword> = {
      BOM: "bom",
      OK: "ok",
      RUIM: "ruim",
      "NÃO APARECEU": "no_show",
      "NAO APARECEU": "no_show",
    };
    const ratingKw = ratingMap[upper];

    if (ratingKw) {
      const [ratingConv] = await db
        .select()
        .from(waConversationsTable)
        .where(
          and(
            eq(waConversationsTable.household_id, householdId),
            eq(waConversationsTable.sender_phone, phoneRaw),
            eq(waConversationsTable.thread_context, "rating_request"),
            eq(waConversationsTable.state, "awaiting_confirmation"),
            sql`${waConversationsTable.expires_at} > NOW()`,
          ),
        )
        .orderBy(desc(waConversationsTable.created_at))
        .limit(1);

      if (ratingConv) {
        const ratingPayload = ratingConv.proposed_payload as unknown as {
          contact_id?: number;
          contact_name?: string;
        } | null;
        const contactId = ratingPayload?.contact_id;
        const contactName = ratingPayload?.contact_name ?? "prestador";

        if (contactId) {
          const result = await applyContactRating(
            contactId,
            householdId,
            ratingKw,
            `wa:${phoneRaw}`,
          );

          if (result) {
            // Close the rating conversation so it cannot be re-used.
            await db
              .update(waConversationsTable)
              .set({ state: "completed" })
              .where(eq(waConversationsTable.id, ratingConv.id));

            log.info(
              {
                contactId,
                contactName,
                rating: ratingKw,
                reliabilityStatus: result.contact.reliability_status,
                suggestUpgrade: result.suggest_upgrade,
                householdId,
              },
              "Provider rated via WhatsApp",
            );

            return {
              kind: "provider_rated",
              contactId,
              contactName,
              rating: ratingKw,
              reliabilityStatus: result.contact.reliability_status ?? "untested",
              noShowCount: result.contact.no_show_count ?? 0,
              suggestUpgrade: result.suggest_upgrade,
              suggestAvoid: result.suggest_avoid,
              householdId,
              phone: phoneRaw,
            };
          }
        }
      }
    }
  }

  // ── 4.57. Preferred-upgrade confirmation reply (SIM / NÃO) ──────────────
  // After two consecutive "bom" ratings, the admin is asked to promote the
  // provider to "preferred". This step handles the SIM / NÃO reply.
  if (bodyText && senderIsAdmin) {
    const upper = bodyText.trim().toUpperCase();
    if (upper === "SIM" || upper === "NÃO" || upper === "NAO") {
      const [prefConv] = await db
        .select()
        .from(waConversationsTable)
        .where(
          and(
            eq(waConversationsTable.household_id, householdId),
            eq(waConversationsTable.sender_phone, phoneRaw),
            eq(waConversationsTable.thread_context, "suggest_preferred"),
            eq(waConversationsTable.state, "awaiting_confirmation"),
            sql`${waConversationsTable.expires_at} > NOW()`,
          ),
        )
        .orderBy(desc(waConversationsTable.created_at))
        .limit(1);

      if (prefConv) {
        const prefPayload = prefConv.proposed_payload as unknown as { contact_id?: number; contact_name?: string } | null;
        const prefContactId = prefPayload?.contact_id;
        const prefContactName = prefPayload?.contact_name ?? "prestador";

        if (prefContactId) {
          await db
            .update(waConversationsTable)
            .set({ state: "completed" })
            .where(eq(waConversationsTable.id, prefConv.id));

          if (upper === "SIM") {
            await db
              .update(contactsTable)
              .set({ reliability_status: "preferred" })
              .where(
                and(
                  eq(contactsTable.id, prefContactId),
                  eq(contactsTable.household_id, householdId),
                ),
              );

            await db.insert(auditLogTable).values({
              household_id: householdId,
              action: "contact_promoted_preferred",
              actor: `wa:${phoneRaw}`,
              action_type: "updated",
              category: "contacts",
              description: `Prestador "${prefContactName}" promovido para "preferido" via WhatsApp.`,
              metadata: { contact_id: prefContactId, contact_name: prefContactName },
            });

            return {
              kind: "promoted_to_preferred",
              contactId: prefContactId,
              contactName: prefContactName,
              householdId,
              phone: phoneRaw,
            };
          } else {
            return {
              kind: "suggest_preferred_declined",
              contactId: prefContactId,
              contactName: prefContactName,
              householdId,
              phone: phoneRaw,
            };
          }
        }
      }
    }
  }

  // ── 4.56. Avoid-marking confirmation reply (SIM / NÃO) ───────────────────
  // Handles admin confirming or declining to mark a provider as "avoid" after
  // receiving a "ruim" rating or ≥ 2 no-shows.
  if (bodyText && senderIsAdmin) {
    const upper = bodyText.trim().toUpperCase();
    if (upper === "SIM" || upper === "NÃO" || upper === "NAO") {
      const [avoidConv] = await db
        .select()
        .from(waConversationsTable)
        .where(
          and(
            eq(waConversationsTable.household_id, householdId),
            eq(waConversationsTable.sender_phone, phoneRaw),
            eq(waConversationsTable.thread_context, "avoid_confirm"),
            eq(waConversationsTable.state, "awaiting_confirmation"),
            sql`${waConversationsTable.expires_at} > NOW()`,
          ),
        )
        .orderBy(desc(waConversationsTable.created_at))
        .limit(1);

      if (avoidConv) {
        const avoidPayload = avoidConv.proposed_payload as unknown as { contact_id?: number; contact_name?: string } | null;
        const avoidContactId = avoidPayload?.contact_id;
        const avoidContactName = avoidPayload?.contact_name ?? "prestador";

        if (avoidContactId) {
          await db
            .update(waConversationsTable)
            .set({ state: "completed" })
            .where(eq(waConversationsTable.id, avoidConv.id));

          if (upper === "SIM") {
            await db
              .update(contactsTable)
              .set({ reliability_status: "avoid" })
              .where(
                and(
                  eq(contactsTable.id, avoidContactId),
                  eq(contactsTable.household_id, householdId),
                ),
              );

            await db.insert(auditLogTable).values({
              household_id: householdId,
              action: "contact_marked_avoid",
              actor: `wa:${phoneRaw}`,
              action_type: "updated",
              category: "contacts",
              description: `Prestador "${avoidContactName}" marcado como "evitar" via WhatsApp.`,
              metadata: { contact_id: avoidContactId, contact_name: avoidContactName },
            });

            return {
              kind: "avoid_confirmed",
              contactId: avoidContactId,
              contactName: avoidContactName,
              householdId,
              phone: phoneRaw,
            };
          } else {
            return {
              kind: "avoid_cancelled",
              contactId: avoidContactId,
              contactName: avoidContactName,
              householdId,
              phone: phoneRaw,
            };
          }
        }
      }
    }
  }

  // ── 4.58b. "Adicionar membro" — admin DM command to generate a member WA invite ──
  // Recognised before the mutation handler so the LLM is never involved.
  if (bodyText && senderIsAdmin && !payload.groupId && isAddMemberCommand(bodyText)) {
    log.info(
      { householdId, phone: phoneRaw, preview: bodyText.substring(0, 60) },
      "wa-invite: admin issued add-member command",
    );
    const reply = await handleAddMemberInviteCommand(bodyText, householdId, log);
    return { kind: "question_answered", reply, householdId, phone: phoneRaw };
  }

  // ── 4.58c. Calendar query intent (DM + group, admin only) ──────────────────
  // Intercepts questions about the calendar with arbitrary date references:
  //   "O que tenho amanhã?", "Minha agenda de quinta", "Tem algo no sábado?",
  //   "Que horas é a reunião do colégio?"
  //
  // A lightweight regex pre-filter avoids an LLM call for every unrelated
  // message.  The handler uses a focused LLM prompt to resolve the date range,
  // queries calendar_events, and returns a formatted reply without creating an
  // inbox item.
  //
  // Works in both DM and group chat; group messages arrive here with the
  // /vesta prefix already stripped.  Mutation commands (cancela, cria, …) do
  // not pass the regex filter and flow on to step 4.59 as before.
  if (bodyText && senderIsAdmin && isCalendarQuery(bodyText)) {
    const calResult = await handleCalendarQueryIntent(bodyText, householdId, log);
    if (calResult) {
      log.info(
        { householdId, phone: phoneRaw, preview: bodyText.substring(0, 60) },
        "wa-calendar-query: answered calendar query — skipping ingestion",
      );
      return { kind: "question_answered", reply: calResult.reply, householdId, phone: phoneRaw };
    }
    // handler returned null → not a calendar query after deeper inspection, fall through
  }

  // ── 4.58d. "Cancela lembrete" — cancel most recent unfired reminder ─────────
  // Any verified household member (not just admins) can cancel their own reminders.
  // Handled before the mutation interceptor so the LLM is never involved.
  if (bodyText && !payload.groupId && isCancelReminderIntent(bodyText)) {
    log.info(
      { householdId, phone: phoneRaw, preview: bodyText.substring(0, 60) },
      "wa-reminder: cancel lembrete command detected",
    );
    const reply = await handleCancelReminderIntent(householdId, phoneRaw, log);
    return { kind: "question_answered", reply, householdId, phone: phoneRaw };
  }

  // ── 4.58e. "Me lembra de X às Y" — set an ad-hoc reminder ─────────────────
  // Any verified household member (not just admins) can set reminders in a DM.
  // Handled before the mutation interceptor; group reminders are excluded
  // because reminder confirmation (quiet hours) relies on a 1:1 DM flow.
  if (bodyText && !payload.groupId && isReminderIntent(bodyText)) {
    log.info(
      { householdId, phone: phoneRaw, preview: bodyText.substring(0, 60) },
      "wa-reminder: reminder intent detected",
    );
    const reply = await handleSetReminderIntent(bodyText, householdId, phoneRaw, log);
    return { kind: "question_answered", reply, householdId, phone: phoneRaw };
  }

  // ── 4.59. Mutation intent proposal (DM only, admin only) ─────────────────
  // When a DM admin sends a mutation command ("Cancela aquela reunião", "Cria
  // uma tarefa…"), route to the mutation handler which parses the intent,
  // resolves the target entity, and creates a mutation_confirm conversation.
  //
  // Group mutation commands are already blocked at the group_mutation_blocked
  // gate (section 4.0) and never reach this point.
  //
  // The Q&A handler (4.60) also has a mutation guard that returns a "not
  // supported" reply — that guard now serves as a fallback only for edge cases
  // not caught here.
  if (bodyText && senderIsAdmin && !payload.groupId && isMutationCommand(bodyText)) {
    log.info(
      { householdId, phone: phoneRaw, preview: bodyText.substring(0, 60) },
      "wa-mutation: DM mutation command intercepted — routing to mutation handler",
    );
    const mutResult = await handleMutationIntent(bodyText, householdId, phoneRaw, log);

    if (mutResult?.kind === "proposed") {
      // Admin entered a mutation flow — clear any open Q&A session
      void clearQaSession(phoneRaw, householdId);
      return {
        kind: "mutation_proposed_via_wa",
        proposal: mutResult.proposal,
        householdId,
        phone: phoneRaw,
      };
    }
    if (mutResult?.kind === "error") {
      return {
        kind: "mutation_error_via_wa",
        reply: mutResult.reply,
        householdId,
        phone: phoneRaw,
      };
    }
    // Shouldn't reach here, but fall through to Q&A as a safety net
  }

  // ── 4.60. Conversational Q&A — admin questions about household data ─────────
  // Intercept recognised questions (agenda, tasks, inbox) from the household
  // admin and reply with live data instead of routing to the ingestion pipeline.
  // Non-question messages return undefined here and fall through normally.
  // The mutation guard inside handleQuestionIntent is now a fallback only.
  if (bodyText && senderIsAdmin) {
    const qaResult = await handleQuestionIntent(bodyText, householdId, phoneRaw, log);
    if (qaResult) {
      log.info(
        { householdId, phone: phoneRaw, preview: bodyText.substring(0, 60) },
        "wa-qa: answered household question — skipping ingestion",
      );
      return { kind: "question_answered", reply: qaResult.reply, householdId, phone: phoneRaw };
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
    consentGranted = isConsentActive(contactMatch);
    if (!consentGranted) {
      log.info(
        {
          contactId: contactMatch.id,
          householdId,
          consentStatus: contactMatch.consent_status,
          consentCheckInDueAt: contactMatch.consent_check_in_due_at,
        },
        "Outbound WhatsApp reply suppressed — contact consent inactive or expired",
      );
    }
    log.info(
      { contact: contactMatch.name, householdId, consent: contactMatch.consent_status, consentActive: consentGranted },
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
    if (!(await checkMediaRateLimit(phoneNorm))) {
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

    // ── 5.5. Low-confidence voice gate ────────────────────────────────────────
    // If Whisper confidence is below 0.70, hold the inbox item in "pending"
    // status and send the user an interactive Sim/Não confirmation before
    // running the classifier — avoids misclassifying garbled transcripts.
    // Group voice messages skip this gate (group DMs are admin-reviewed anyway).
    // Contacts with inactive consent also skip the gate: no outbound WA message
    // is sent to non-consented contacts (same policy as the normal ingestion path).
    const confidence = processed.transcriptionConfidence;
    if (
      processed.source === "voice" &&
      !payload.groupId &&
      confidence !== undefined &&
      confidence < 0.70 &&
      (!senderIsContact || consentGranted)
    ) {
      const preview = rawContent.length > 100 ? rawContent.substring(0, 97) + "…" : rawContent;
      const phoneNorm = normalisePhone(phoneRaw);

      // Create a pending inbox item so the transcript is preserved even if
      // the user dismisses ("não") or the conversation expires.
      const [pendingItem] = await db
        .insert(inboxItemsTable)
        .values({
          household_id: householdId,
          source: "voice",
          raw_content: rawContent,
          media_url: payload.mediaUrl ?? null,
          media_type: payload.mediaContentType ?? null,
          transcription: rawContent,
          status: "pending",
          sender_name: senderName,
          twilio_message_sid: payload.messageSid ?? null,
          group_id: null,
        })
        .returning();

      // Open a voice_confirm conversation so the sim/não handler can find it.
      await db.insert(waConversationsTable).values({
        household_id: householdId,
        sender_phone: phoneNorm,
        state: "awaiting_confirmation",
        thread_context: "voice_confirm",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        proposed_payload: { inbox_item_id: pendingItem.id, preview } as any,
        expires_at: new Date(Date.now() + VOICE_CONFIRM_TTL_MS),
      });

      log.info(
        { inboxItemId: pendingItem.id, householdId, confidence, preview: preview.substring(0, 60) },
        "Voice transcript confidence below 0.70 — awaiting sender confirmation",
      );

      return {
        kind: "voice_confirm_pending",
        inboxItemId: pendingItem.id,
        householdId,
        phone: phoneRaw,
        preview,
      };
    }
  } else if (!rawContent) {
    rawContent = "(mídia recebida)";
  }

  // ── 6. Create inbox item ───────────────────────────────────────────────────
  const [item] = await db
    .insert(inboxItemsTable)
    .values({
      household_id: householdId,
      // Group /vesta commands are tagged "group" so the inbox UI can surface a
      // badge and distinguish them from regular WhatsApp DM forwards.
      source: payload.groupId ? "group" : source,
      raw_content: rawContent,
      media_url: payload.mediaUrl ?? null,
      media_type: payload.mediaContentType ?? null,
      transcription: source === "voice" ? rawContent : null,
      status: "classifying",
      sender_name: senderName,
      twilio_message_sid: payload.messageSid ?? null,
      group_id: payload.groupId ?? null,
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
      confidence: suggestedActionsTable.confidence,
      cascade_check_needed: suggestedActionsTable.cascade_check_needed,
      workflow_tags: suggestedActionsTable.workflow_tags,
    })
    .from(suggestedActionsTable)
    .where(eq(suggestedActionsTable.inbox_item_id, item.id))
    .limit(1);

  // ── 8. WA-native eligibility decision ───────────────────────────────────
  // Only bind the prompt (and thus allow WhatsApp approvals) when all four
  // criteria are met. For anything that falls below this bar (low confidence,
  // multi-intent cascade, payment, or explicit-review level) we deliberately
  // skip recordPrompt so the approval handler can never grant a WA-only approval
  // for items that require app review.
  const waEligible =
    savedAction !== undefined &&
    (savedAction.confidence ?? 0) >= 0.80 &&
    !(savedAction.cascade_check_needed ?? false) &&
    !(savedAction.workflow_tags ?? []).includes("payment_admin") &&
    (savedAction.approval_level ?? "one_tap") !== "explicit";

  if (waEligible && savedAction.id && savedAction.title) {
    await recordPrompt(
      phoneRaw,
      savedAction.id,
      householdId,
      {
        title: savedAction.title,
        type: savedAction.type,
        category: savedAction.category,
        datetime: savedAction.datetime ?? null,
      },
      payload.messageSid ?? undefined,
    );
    log.info(
      { phone: phoneRaw, actionId: savedAction.id },
      "Bound proposed action to sender phone — WA-native eligible",
    );
  } else if (savedAction?.id) {
    log.info(
      {
        phone: phoneRaw,
        actionId: savedAction.id,
        confidence: savedAction.confidence,
        cascadeCheckNeeded: savedAction.cascade_check_needed,
        approvalLevel: savedAction.approval_level,
      },
      "Action requires app review — skipping WA prompt binding",
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
    actionId: savedAction?.id ?? null,
    actionTitle: savedAction?.title ?? null,
    actionType: savedAction?.type ?? null,
    actionCategory: savedAction?.category ?? null,
    actionDatetime: savedAction?.datetime ?? null,
    confidence: savedAction?.confidence ?? 0.55,
    cascadeCheckNeeded: savedAction?.cascade_check_needed ?? false,
    workflowTags: savedAction?.workflow_tags ?? [],
    waCanApproveViaWa: waEligible,
  };
}
