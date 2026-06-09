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
  proactiveMessageQueueTable,
  waConversationsTable,
  auditLogTable,
  waMediaRateLimitsTable,
} from "@workspace/db";
import { applyContactRating } from "./provider-rating";
import type { RatingKeyword } from "./provider-rating";
import { eq, and, or, sql, desc } from "drizzle-orm";
import { classifyAndSaveAction } from "./classifier";
import { processWhatsAppMedia } from "./media-analysis";
import { looksLikeToken, markTokenVerified } from "./wa-token-store";
import { handleApprovalResponse } from "./wa-approval-handler";
import { recordPrompt } from "./wa-prompt-store";
import { detectPatternsForHousehold } from "./pattern-detector";
import { isConsentActive } from "./whatsapp";
import { handleQuestionIntent, isMutationCommand } from "./wa-qa-handler";

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
  /** A /vesta group command arrived from a non-admin household member. */
  | { kind: "group_non_admin"; phone: string; groupId: string }
  /** A mutation command (cancela, cria, apaga…) arrived from a group chat. */
  | { kind: "group_mutation_blocked"; phone: string; groupId: string }
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
  householdId: number;
  matchedMembers: MatchedMember[];
  matchedContacts: MatchedContact[];
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
): Promise<ResolvedHousehold | null> {
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
    return null; // truly unknown sender
  }

  if (allMatchingHouseholdIds.size === 1) {
    const householdId = [...allMatchingHouseholdIds][0];
    return { householdId, matchedMembers, matchedContacts };
  }

  // Multiple households claim this phone via any combination of member/contact
  // records. Fail-closed: no routing guess, no tie-breaker.
  log.warn(
    { phone: phoneRaw, households: [...allMatchingHouseholdIds] },
    "Phone matched multiple households (members and/or contacts) — discarding to prevent cross-tenant misdelivery",
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

  if (bodyText && senderIsAdmin) {
    const approvalOutcome = await handleApprovalResponse(bodyText, householdId, phoneRaw, log);
    if (approvalOutcome) {
      return { ...approvalOutcome, phone: phoneRaw };
    }
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

  // ── 4.57. Conversational Q&A — admin questions about household data ─────────
  // Intercept recognised questions (agenda, tasks, inbox) from the household
  // admin and reply with live data instead of routing to the ingestion pipeline.
  // Non-question messages return undefined here and fall through normally.
  if (bodyText && senderIsAdmin) {
    const qaResult = await handleQuestionIntent(bodyText, householdId, log);
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
