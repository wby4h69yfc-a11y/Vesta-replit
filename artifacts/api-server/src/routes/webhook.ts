import { Router, type Request, type Response } from "express";
import { getBspAdapter } from "../lib/wa-bsp";
import type { ProcessOutcome } from "../lib/wa-message-processor";
import { isTwilioConfigured, sendWhatsApp, sendWhatsAppInteractive, resolveHouseholdAdminPhone, classifyWhatsAppError } from "../lib/whatsapp";
import { validateTwilioRequest } from "../lib/wa-bsp-twilio";
import { processInboundWAMessage } from "../lib/wa-message-processor";
import { isGroupMessage, extractVestaTrigger } from "../lib/wa-group-trigger";
import { db } from "@workspace/db";
import {
  householdsTable,
  onboardingStateTable,
  waConversationsTable,
  contactsTable,
  membersTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  replyVerificationSuccess,
  replyTokenExpired,
  replyIngestAck,
  replyApproved,
  replyDismissed,
  replyEditPrompt,
  replyNlEditProposal,
  replyUndone,
  replyExplicitReviewNeeded,
  replyAppDeepLink,
  replyConsentGranted,
  replyConsentRevoked,
  notifyAdminConsentGranted,
  notifyAdminConsentRevoked,
  replyRatingBom,
  replyRatingOk,
  replyRatingRuim,
  replyRatingNoShow,
  replyRatingSuggestPreferred,
  replyAvoidConfirmed,
  replyAvoidCancelled,
  replyPreferredPromoted,
  replyPreferredDeclined,
  replyGroupNonAdmin,
  replyGroupMutationBlocked,
  replyMutationProposal,
  replyMutationExecuted,
  replyMutationDismissed,
  replyMutationError,
  replyVoiceProcessingAck,
  replyVoiceConfirmInteractive,
  replyPendingItemsNotice,
  composeApprovalInteractive,
  composeMutationConfirmInteractive,
} from "../lib/wa-reply-composer";

const router = Router();

/**
 * Returns true when `senderPhone` (E.164 string) belongs to a known
 * household participant: verified admin, household member, or external contact.
 *
 * Used to gate the voice-processing ACK so it is never sent to unknown/spam
 * senders who could use a reply as an endpoint-enumeration signal.
 * Checks admin first (most common path) then contacts, then members.
 */
async function isKnownSender(senderPhone: string): Promise<boolean> {
  const phoneNorm = senderPhone.replace(/\D/g, "");

  const [admin] = await db
    .select({ id: onboardingStateTable.household_id })
    .from(onboardingStateTable)
    .where(eq(onboardingStateTable.whatsapp_verified_phone, senderPhone))
    .limit(1);
  if (admin) return true;

  const [contact] = await db
    .select({ id: contactsTable.id })
    .from(contactsTable)
    .where(sql`regexp_replace(${contactsTable.phone}, '\\D', '', 'g') = ${phoneNorm}`)
    .limit(1);
  if (contact) return true;

  const [member] = await db
    .select({ id: membersTable.id })
    .from(membersTable)
    .where(sql`regexp_replace(${membersTable.phone}, '\\D', '', 'g') = ${phoneNorm}`)
    .limit(1);
  return member !== undefined;
}

/** Resolve the primary production domain for app deep-links. */
function primaryDomain(): string | null {
  const domains = (process.env.REPLIT_DOMAINS ?? "").split(",").filter(Boolean);
  return domains[0] ?? process.env.REPLIT_DEV_DOMAIN ?? null;
}

/**
 * Processes a WhatsApp delivery status update from either BSP.
 *
 * Looks up the household whose verified phone matches `phone`, then:
 *   - `delivered` / `read`         → resets whatsapp_consecutive_failures to 0
 *   - `failed` / `undelivered`     → increments counter, stores reason
 *
 * Unknown phones (not matched to any household) are silently ignored.
 *
 * @param phone     Recipient phone — digits only or with whatsapp: / + prefix
 * @param status    BSP status string (delivered | read | failed | undelivered | sent)
 * @param errorCode Optional BSP error descriptor (Twilio numeric code or 360Dialog error title)
 * @param req       Express request used for structured logging
 */
async function handleDeliveryStatus(
  phone: string,
  status: string,
  errorCode: string | undefined,
  req: Request,
): Promise<void> {
  const phoneNorm = phone.replace(/^whatsapp:/i, "").replace(/^\+/, "");

  const [row] = await db
    .select({ household_id: onboardingStateTable.household_id })
    .from(onboardingStateTable)
    .where(eq(onboardingStateTable.whatsapp_verified_phone, phoneNorm))
    .limit(1);

  if (!row) {
    req.log.info({ status }, "delivery-status: no matching household for phone — ignoring");
    return;
  }

  const hid = row.household_id;

  if (status === "delivered" || status === "read") {
    await db
      .update(householdsTable)
      .set({ whatsapp_consecutive_failures: 0, whatsapp_last_failure_at: null })
      .where(eq(householdsTable.id, hid));
    req.log.info({ householdId: hid, status }, "delivery-status: delivered — failure counters reset");
  } else if (status === "failed" || status === "undelivered") {
    const errorMsg = errorCode ? `Error code: ${errorCode}` : status;
    const reason = classifyWhatsAppError(errorMsg);
    await db
      .update(householdsTable)
      .set({
        whatsapp_consecutive_failures: sql`${householdsTable.whatsapp_consecutive_failures} + 1`,
        whatsapp_last_failure_at: new Date(),
        whatsapp_last_failure_reason: reason,
      })
      .where(eq(householdsTable.id, hid));
    req.log.warn(
      { householdId: hid, status, errorCode, reason },
      "delivery-status: carrier failure — counter incremented",
    );
  }
}

/**
 * Shared outcome dispatcher — called by both the Twilio and 360Dialog webhook
 * routes after processInboundWAMessage returns.
 *
 * @param outcome   Typed result from processInboundWAMessage.
 * @param replyDest Maps a sender phone to the reply address (sender DM, or
 *                  the group JID for group-sourced messages).
 * @param req       Express request, used for structured logging.
 */
async function handleWaOutcome(
  outcome: ProcessOutcome,
  replyDest: (phone: string) => string,
  req: Request,
): Promise<void> {
  switch (outcome.kind) {
    case "token_verified":
      void sendWhatsApp(replyDest(outcome.phone), replyVerificationSuccess());
      break;

    case "token_expired":
      void sendWhatsApp(replyDest(outcome.phone), replyTokenExpired());
      break;

    // ── WhatsApp group: non-admin tried /vesta ──────────────────────────────
    case "group_non_admin":
      void sendWhatsApp(outcome.groupId, replyGroupNonAdmin());
      req.log.info(
        { groupId: outcome.groupId, phone: outcome.phone, source: "group" },
        "Group /vesta command rejected — non-admin sender",
      );
      break;

    // ── WhatsApp group: admin issued a mutation command in a group thread ───
    case "group_mutation_blocked":
      void sendWhatsApp(outcome.groupId, replyGroupMutationBlocked());
      req.log.info(
        { groupId: outcome.groupId, phone: outcome.phone, source: "group" },
        "Group /vesta mutation command blocked — redirect to DM sent",
      );
      break;

    // ── WA-native approval responses ────────────────────────────────────────
    case "approved_via_wa":
      void sendWhatsApp(replyDest(outcome.phone), replyApproved(outcome.actionTitle));
      req.log.info({ actionId: outcome.actionId }, "Sent approved reply via WhatsApp");
      break;

    case "dismissed_via_wa":
      void sendWhatsApp(replyDest(outcome.phone), replyDismissed());
      break;

    // Standalone "editar" — ask the user what they want to change
    case "edit_prompt_via_wa":
      void sendWhatsApp(replyDest(outcome.phone), replyEditPrompt());
      req.log.info({ actionId: outcome.actionId }, "Edit prompt sent — awaiting_edit state");
      break;

    // NL / structured edit applied — re-propose updated item for confirmation
    case "nl_edit_proposed_via_wa":
      void sendWhatsApp(replyDest(outcome.phone), replyNlEditProposal(outcome.newTitle));
      req.log.info(
        { actionId: outcome.actionId, newTitle: outcome.newTitle },
        "Edit re-proposed via WhatsApp",
      );
      break;

    case "undone_via_wa":
      void sendWhatsApp(replyDest(outcome.phone), replyUndone(outcome.actionTitle));
      break;

    case "consent_updated": {
      // Consent replies always go to the sender DM, never to a group.
      void sendWhatsApp(
        outcome.phone,
        outcome.newStatus === "consented" ? replyConsentGranted() : replyConsentRevoked(),
      );
      req.log.info(
        { contactId: outcome.contactId, newStatus: outcome.newStatus },
        "Consent updated via WhatsApp reply — ack sent",
      );

      // Notify the household admin so they know the consent loop closed.
      const adminPhone = await resolveHouseholdAdminPhone(outcome.householdId);
      if (adminPhone && adminPhone !== outcome.phone) {
        const adminMsg =
          outcome.newStatus === "consented"
            ? notifyAdminConsentGranted(outcome.contactName)
            : notifyAdminConsentRevoked(outcome.contactName);
        void sendWhatsApp(adminPhone, adminMsg);
        req.log.info(
          { householdId: outcome.householdId, contactId: outcome.contactId, newStatus: outcome.newStatus },
          "Consent change notification sent to household admin",
        );
      }
      break;
    }

    // ── New inbound message — classified and routed ──────────────────────────
    case "ingested": {
      if (!outcome.consentGranted) break;

      if (!outcome.actionTitle) {
        void sendWhatsApp(replyDest(outcome.phone), replyIngestAck());
        break;
      }

      const domain = primaryDomain();

      if (outcome.waCanApproveViaWa && !outcome.hadExistingOpenPrompt) {
        req.log.info(
          { actionId: outcome.actionId, confidence: outcome.confidence },
          "WA-native flow: sending interactive action proposal",
        );
        // Try interactive buttons first; falls back to plain text automatically
        void sendWhatsAppInteractive(
          replyDest(outcome.phone),
          composeApprovalInteractive(
            outcome.actionTitle,
            outcome.actionType,
            outcome.actionCategory,
            outcome.actionDatetime,
          ),
        ).then(({ usedFallback }) => {
          if (usedFallback) {
            req.log.info(
              { actionId: outcome.actionId },
              "WA approval proposal sent as plain text (interactive not supported)",
            );
          }
        });
      } else if (outcome.waCanApproveViaWa && outcome.hadExistingOpenPrompt) {
        // A prompt is already open for this sender — send a plain-text notice
        // instead of a second set of buttons to avoid duplicate button sets in chat.
        req.log.info(
          { actionId: outcome.actionId },
          "Existing approval prompt open — suppressing duplicate buttons, sending plain-text notice",
        );
        void sendWhatsApp(replyDest(outcome.phone), replyPendingItemsNotice());
      } else {
        req.log.info(
          {
            actionId: outcome.actionId,
            confidence: outcome.confidence,
            cascadeCheckNeeded: outcome.cascadeCheckNeeded,
            approvalLevel: outcome.approvalLevel,
          },
          "App-required path: sending deep link",
        );
        void sendWhatsApp(replyDest(outcome.phone), replyAppDeepLink(outcome.actionTitle, domain));
      }

      // Notify household admin for explicit-approval items (always DM, not group).
      if (outcome.approvalLevel === "explicit" && outcome.senderName) {
        const adminPhone = await resolveHouseholdAdminPhone(outcome.householdId);
        if (adminPhone && adminPhone !== outcome.phone) {
          void sendWhatsApp(adminPhone, replyExplicitReviewNeeded(outcome.senderName));
        }
      }
      break;
    }

    case "provider_rated": {
      const {
        contactId,
        contactName,
        rating,
        noShowCount,
        suggestUpgrade,
        suggestAvoid,
        householdId: ratedHhId,
        phone: ratedPhone,
      } = outcome;

      let ackMsg: string;
      if (rating === "bom") {
        ackMsg = replyRatingBom(contactName);
      } else if (rating === "ok") {
        ackMsg = replyRatingOk(contactName);
      } else if (rating === "ruim") {
        ackMsg = replyRatingRuim(contactName);
      } else {
        ackMsg = replyRatingNoShow(contactName, noShowCount);
      }
      void sendWhatsApp(replyDest(ratedPhone), ackMsg);

      if (suggestUpgrade) {
        void sendWhatsApp(replyDest(ratedPhone), replyRatingSuggestPreferred(contactName));
        void db.insert(waConversationsTable).values({
          household_id: ratedHhId,
          sender_phone: ratedPhone,
          state: "awaiting_confirmation",
          thread_context: "suggest_preferred",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          proposed_payload: { contact_id: contactId, contact_name: contactName } as any,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
        });
      }

      if (suggestAvoid) {
        void db.insert(waConversationsTable).values({
          household_id: ratedHhId,
          sender_phone: ratedPhone,
          state: "awaiting_confirmation",
          thread_context: "avoid_confirm",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          proposed_payload: { contact_id: contactId, contact_name: contactName } as any,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
        });
      }

      req.log.info(
        { contactName, rating, noShowCount, suggestUpgrade, suggestAvoid },
        "Provider rated — WA ack sent",
      );
      break;
    }

    case "avoid_confirmed":
      void sendWhatsApp(replyDest(outcome.phone), replyAvoidConfirmed(outcome.contactName));
      req.log.info({ contactName: outcome.contactName }, "Provider marked as avoid — WA confirmed");
      break;

    case "avoid_cancelled":
      void sendWhatsApp(replyDest(outcome.phone), replyAvoidCancelled(outcome.contactName));
      req.log.info({ contactName: outcome.contactName }, "Avoid marking cancelled by admin");
      break;

    case "promoted_to_preferred":
      void sendWhatsApp(replyDest(outcome.phone), replyPreferredPromoted(outcome.contactName));
      req.log.info({ contactName: outcome.contactName }, "Provider promoted to preferred — WA ack sent");
      break;

    case "suggest_preferred_declined":
      void sendWhatsApp(replyDest(outcome.phone), replyPreferredDeclined(outcome.contactName));
      req.log.info({ contactName: outcome.contactName }, "Preferred upgrade declined by admin");
      break;

    case "question_answered":
      void sendWhatsApp(replyDest(outcome.phone), outcome.reply);
      req.log.info(
        { householdId: outcome.householdId, preview: outcome.reply.substring(0, 80) },
        "Q&A reply sent to admin via WhatsApp",
      );
      break;

    case "mutation_proposed_via_wa":
      // Try interactive Sim/Não buttons first; fall back to plain text automatically.
      void sendWhatsAppInteractive(
        replyDest(outcome.phone),
        composeMutationConfirmInteractive(outcome.proposal),
      ).then(({ usedFallback }) => {
        req.log.info(
          {
            householdId: outcome.householdId,
            preview: outcome.proposal.substring(0, 80),
            usedFallback,
          },
          "Mutation proposal sent to admin via WhatsApp",
        );
      });
      break;

    case "mutation_executed_via_wa":
      void sendWhatsApp(replyDest(outcome.phone), replyMutationExecuted(outcome.description));
      req.log.info(
        { householdId: outcome.householdId, description: outcome.description },
        "Mutation executed via WhatsApp — confirmation sent",
      );
      break;

    case "mutation_dismissed_via_wa":
      void sendWhatsApp(replyDest(outcome.phone), replyMutationDismissed());
      req.log.info({ householdId: outcome.householdId }, "Mutation proposal dismissed by admin");
      break;

    case "mutation_error_via_wa":
      void sendWhatsApp(replyDest(outcome.phone), replyMutationError(outcome.reply));
      req.log.info(
        { householdId: outcome.householdId, preview: outcome.reply.substring(0, 80) },
        "Mutation error reply sent to admin via WhatsApp",
      );
      break;

    case "wa_onboarding":
      void sendWhatsApp(outcome.phone, outcome.reply);
      req.log.info(
        { phone: outcome.phone, preview: outcome.reply.substring(0, 80) },
        "WA onboarding reply sent",
      );
      break;

    case "voice_confirm_pending": {
      // A voice transcript was created but Whisper confidence was < 0.70.
      // Send an interactive Sim/Não card so the sender can confirm or dismiss.
      const interactive = replyVoiceConfirmInteractive(outcome.preview);
      void sendWhatsAppInteractive(outcome.phone, interactive);
      req.log.info(
        {
          inboxItemId: outcome.inboxItemId,
          householdId: outcome.householdId,
          phone: outcome.phone,
        },
        "Low-confidence voice transcript — sent Sim/Não confirmation to sender",
      );
      break;
    }

    case "voice_confirm_dismissed": {
      // The sender replied "não" — transcript was dismissed.
      // Send a brief acknowledgement so the UX feels complete.
      void sendWhatsApp(
        outcome.phone,
        "Tudo bem! 🎤 Desconsiderei o áudio.",
      );
      req.log.info(
        { householdId: outcome.householdId, phone: outcome.phone },
        "Sender dismissed voice transcript — item abandoned",
      );
      break;
    }

    case "unknown_sender":
    case "multi_household":
    case "duplicate":
    case "empty_message":
    case "media_rate_limited":
      // No reply — do not confirm to unknown/spam senders that the number is active.
      break;
  }
}

/**
 * POST /api/webhook/whatsapp
 *
 * Twilio WhatsApp inbound webhook.
 * Configure in Twilio Console → Messaging → Active Numbers → Webhook:
 *   POST https://<your-domain>/api/webhook/whatsapp
 *
 * Architecture:
 *   1. Authenticate (Twilio HMAC via WaBspTwilioAdapter)
 *   2. ACK Twilio immediately with TwiML (prevents retries)
 *   3. Parse inbound payload via adapter
 *   4. Handle group detection and /vesta trigger filter
 *   5. Handle Tier-0 keywords (PAUSAR / PARAR / RETOMAR)
 *   6. Delegate to WhatsAppMessageProcessor
 *   7. Send WhatsApp reply via handleWaOutcome
 */
router.post("/webhook/whatsapp", async (req: Request, res: Response) => {
  const adapter = getBspAdapter();

  // ── 1. Authenticate ──────────────────────────────────────────────────────
  const isValid = await adapter.validateWebhookRequest(req);
  if (!isValid) {
    req.log.warn({ ip: req.ip }, "Webhook: invalid Twilio signature — rejected");
    res.status(403).send("Forbidden");
    return;
  }

  // ── 2. ACK Twilio immediately so it never retries on timeout ────────────
  res.set("Content-Type", "text/xml");
  res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);

  // ── 3–7. Process asynchronously (response already sent) ─────────────────
  try {
    const parsed = adapter.parseInboundPayload(req.body);
    if (!parsed) return;

    // ── Group detection & /vesta trigger filter ──────────────────────────
    // For Twilio group messages the adapter sets groupId to the group JID
    // (rawTo containing @g.us). For 360Dialog (DM-only for now) it is null.
    const groupSourced = parsed.groupId !== null;
    const groupId = parsed.groupId;

    let effectiveBody = parsed.body;
    if (groupSourced) {
      const stripped = extractVestaTrigger(effectiveBody);
      if (stripped === null) {
        req.log.info(
          { group_id: groupId, from: parsed.from, source: "group" },
          "Group message without /vesta trigger — silently ignored",
        );
        return;
      }
      effectiveBody = stripped;
      req.log.info(
        { group_id: groupId, from: parsed.from, preview: effectiveBody.substring(0, 60), source: "group" },
        "Group /vesta command received",
      );
    }

    // Replies go to the group JID (all members see them) for group messages,
    // or directly to the sender's phone for DMs.
    const replyDest = (phone: string): string => groupId ?? phone;

    // ── Tier-0: PAUSAR / PARAR / RETOMAR + BSP opt-out aliases ─────────
    // Handled before the normal processor to give users immediate control
    // over proactive messages without any AI involvement.
    // STOP, CANCELAR, UNSUBSCRIBE, QUIT are BSP-standard opt-out keywords
    // that map to the same digest_stopped = true action as PARAR.
    const normalizedBody = effectiveBody.toUpperCase();
    const BSP_STOP_KEYWORDS = new Set(["STOP", "CANCELAR", "UNSUBSCRIBE", "QUIT"]);
    if (
      normalizedBody === "PAUSAR" ||
      normalizedBody === "PARAR" ||
      normalizedBody === "RETOMAR" ||
      BSP_STOP_KEYWORDS.has(normalizedBody)
    ) {
      const senderPhone = parsed.from.replace(/^whatsapp:/i, "");

      if (groupSourced) {
        void sendWhatsApp(groupId!, replyGroupMutationBlocked());
        req.log.info(
          { senderPhone, group_id: groupId, command: normalizedBody, source: "group" },
          "Group Tier-0 command rejected — DM-only",
        );
        return;
      }

      const [onboarding] = await db
        .select({ household_id: onboardingStateTable.household_id })
        .from(onboardingStateTable)
        .where(eq(onboardingStateTable.whatsapp_verified_phone, senderPhone))
        .limit(1);

      if (onboarding) {
        if (normalizedBody === "PAUSAR") {
          const pausedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
          await db
            .update(householdsTable)
            .set({ digest_paused_until: pausedUntil, digest_stopped: false })
            .where(eq(householdsTable.id, onboarding.household_id));
          void sendWhatsApp(replyDest(senderPhone), "⏸ Pausei por 24h. Manda *RETOMAR* pra voltar.");
        } else if (normalizedBody === "PARAR" || BSP_STOP_KEYWORDS.has(normalizedBody)) {
          await db
            .update(householdsTable)
            .set({ digest_stopped: true, digest_paused_until: null })
            .where(eq(householdsTable.id, onboarding.household_id));
          void sendWhatsApp(replyDest(senderPhone), "🔕 Tudo bem! Para retomar, mande *RETOMAR*.");
        } else {
          await db
            .update(householdsTable)
            .set({ digest_stopped: false, digest_paused_until: null, digest_enabled: true })
            .where(eq(householdsTable.id, onboarding.household_id));
          void sendWhatsApp(
            replyDest(senderPhone),
            "▶️ Retomado! Você voltará a receber os resumos diários.",
          );
        }
        req.log.info(
          { senderPhone, command: normalizedBody, householdId: onboarding.household_id, source: "dm" },
          "Proactive command processed",
        );
      }
      return;
    }

    // Send an immediate audio ACK to known senders before the slow Whisper
    // transcription runs.  "Known" means: verified admin, household member, or
    // external contact — any participant we'd normally process a message from.
    // Unknown/spam senders receive no reply so the endpoint is not enumerable.
    // Group voice messages are excluded — they use the group JID as destination
    // and have different UX expectations.
    if (
      !groupSourced &&
      parseInt(parsed.numMedia ?? "0", 10) > 0 &&
      (parsed.mediaContentType ?? "").startsWith("audio/")
    ) {
      const senderPhone = parsed.from.replace(/^whatsapp:/i, "");
      if (await isKnownSender(senderPhone)) {
        void sendWhatsApp(senderPhone, replyVoiceProcessingAck());
      }
    }

    const outcome = await processInboundWAMessage(
      { ...parsed, body: effectiveBody },
      req.log,
    );

    req.log.info(
      {
        outcomeKind: outcome.kind,
        source: groupSourced ? "group" : "dm",
        ...(groupId ? { group_id: groupId } : {}),
      },
      "WhatsApp webhook outcome",
    );

    await handleWaOutcome(outcome, replyDest, req);
  } catch (err) {
    req.log.error({ err }, "WhatsApp webhook processing failed");
    // Do NOT re-throw — Twilio response already sent
  }
});

/**
 * POST /api/webhook/whatsapp/status
 *
 * Twilio WhatsApp delivery status callback.
 * Twilio POSTs here automatically for every outgoing message when a
 * StatusCallback URL is included — set by WaBspTwilioAdapter.send().
 *
 * Validates the Twilio HMAC signature, then updates household-level delivery
 * counters based on MessageStatus:
 *   delivered / read       → reset whatsapp_consecutive_failures to 0
 *   failed / undelivered   → increment counter, classify error, store reason
 */
router.post("/webhook/whatsapp/status", async (req: Request, res: Response) => {
  const isValid = await validateTwilioRequest(req, "/api/webhook/whatsapp/status");
  if (!isValid) {
    req.log.warn({ ip: req.ip }, "WA status webhook: invalid Twilio signature — rejected");
    res.status(403).send("Forbidden");
    return;
  }

  // ACK immediately — Twilio expects a 200 on status callbacks
  res.set("Content-Type", "text/xml");
  res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);

  try {
    const body = req.body as Record<string, string | undefined>;
    const messageStatus = (body.MessageStatus ?? "").toLowerCase();
    const toField = body.To ?? "";
    const errorCode = body.ErrorCode;

    if (!messageStatus || !toField) {
      req.log.info("WA status webhook: missing MessageStatus or To — ignoring");
      return;
    }

    req.log.info(
      { messageStatus, hasErrorCode: !!errorCode },
      "WA status webhook received",
    );
    await handleDeliveryStatus(toField, messageStatus, errorCode, req);
  } catch (err) {
    req.log.error({ err }, "WA status webhook processing failed");
  }
});

/**
 * POST /api/webhook/whatsapp/360dialog
 *
 * 360Dialog WhatsApp inbound webhook.
 * Configure in the 360Dialog Hub as the webhook URL for your WABA:
 *   POST https://<your-domain>/api/webhook/whatsapp/360dialog
 *
 * Uses express.raw() to capture the raw body for HMAC-SHA256 validation
 * (X-Hub-Signature-256 header). ACKs with plain 200 OK — no TwiML.
 *
 * Only active when WA_BSP=360dialog. The global auth guard allows this path
 * without a session (it is listed in PUBLIC_API_EXACT in app.ts).
 */
router.post(
  "/webhook/whatsapp/360dialog",
  async (req: Request, res: Response) => {
    const adapter = getBspAdapter();
    // rawBody is captured by the express.json() verify callback in app.ts
    // before the body is parsed, enabling HMAC-SHA256 validation.
    const rawBody = req.rawBody;

    // ── 1. Authenticate (HMAC-SHA256 via X-Hub-Signature-256) ───────────────
    const isValid = await adapter.validateWebhookRequest(req, rawBody);
    if (!isValid) {
      req.log.warn({ ip: req.ip }, "360Dialog webhook: invalid signature — rejected");
      res.status(403).send("Forbidden");
      return;
    }

    // ── 2. ACK immediately — 360Dialog expects plain 200 with empty body ───
    res.status(200).end();

    // ── 3–7. Process asynchronously (response already sent) ─────────────────
    try {
      // Process delivery status updates first — these arrive in the same payload
      // as inbound messages or as status-only payloads (no messages[] array).
      // 360Dialog Cloud API format: statuses[] entries have recipient_id (the
      // destination phone) and status ("sent" | "delivered" | "read" | "failed").
      const bodyObj = req.body as Record<string, unknown>;
      const statuses = bodyObj.statuses as
        | Array<{
            recipient_id?: string;
            status?: string;
            errors?: Array<{ title?: string; code?: number }>;
          }>
        | undefined;

      if (statuses && statuses.length > 0) {
        for (const s of statuses) {
          if (!s.recipient_id || !s.status) continue;
          const errorTitle = s.errors?.[0]?.title;
          await handleDeliveryStatus(s.recipient_id, s.status, errorTitle, req).catch(
            (err: unknown) => {
              req.log.error({ err, status: s.status }, "360Dialog status processing failed");
            },
          );
        }
      }

      // req.body is already parsed by global express.json() middleware.
      // rawBody was preserved by the verify callback solely for HMAC above.
      const message = adapter.parseInboundPayload(req.body);
      if (!message) {
        req.log.info("360Dialog webhook: no processable message in payload — ignoring");
        return;
      }

      // 360Dialog DM-only: group message detection to be refined once the
      // exact group-JID payload format is confirmed. For now all messages
      // are treated as direct messages.
      const replyDest = (phone: string): string => phone;

      // ── Tier-0: PAUSAR / PARAR / RETOMAR + BSP opt-out aliases ──────────
      // STOP, CANCELAR, UNSUBSCRIBE, QUIT are BSP-standard opt-out keywords
      // that map to digest_stopped = true, same as PARAR.
      const normalizedBody = message.body.toUpperCase();
      const BSP_STOP_KEYWORDS_360 = new Set(["STOP", "CANCELAR", "UNSUBSCRIBE", "QUIT"]);
      if (
        normalizedBody === "PAUSAR" ||
        normalizedBody === "PARAR" ||
        normalizedBody === "RETOMAR" ||
        BSP_STOP_KEYWORDS_360.has(normalizedBody)
      ) {
        const senderPhone = message.from.replace(/^whatsapp:/i, "");

        const [onboarding] = await db
          .select({ household_id: onboardingStateTable.household_id })
          .from(onboardingStateTable)
          .where(eq(onboardingStateTable.whatsapp_verified_phone, senderPhone))
          .limit(1);

        if (onboarding) {
          if (normalizedBody === "PAUSAR") {
            const pausedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
            await db
              .update(householdsTable)
              .set({ digest_paused_until: pausedUntil, digest_stopped: false })
              .where(eq(householdsTable.id, onboarding.household_id));
            void sendWhatsApp(senderPhone, "⏸ Pausei por 24h. Manda *RETOMAR* pra voltar.");
          } else if (normalizedBody === "PARAR" || BSP_STOP_KEYWORDS_360.has(normalizedBody)) {
            await db
              .update(householdsTable)
              .set({ digest_stopped: true, digest_paused_until: null })
              .where(eq(householdsTable.id, onboarding.household_id));
            void sendWhatsApp(senderPhone, "🔕 Tudo bem! Para retomar, mande *RETOMAR*.");
          } else {
            await db
              .update(householdsTable)
              .set({ digest_stopped: false, digest_paused_until: null, digest_enabled: true })
              .where(eq(householdsTable.id, onboarding.household_id));
            void sendWhatsApp(
              senderPhone,
              "▶️ Retomado! Você voltará a receber os resumos diários.",
            );
          }
          req.log.info(
            { senderPhone, command: normalizedBody, householdId: onboarding.household_id, source: "dm" },
            "360Dialog Tier-0 command processed",
          );
        }
        return;
      }

      // Same sender-verified audio ACK as the Twilio path — admin, member, or
      // contact qualifies; truly unknown senders receive no reply.
      if (
        parseInt(message.numMedia ?? "0", 10) > 0 &&
        (message.mediaContentType ?? "").startsWith("audio/")
      ) {
        const senderPhone = message.from.replace(/^whatsapp:/i, "");
        if (await isKnownSender(senderPhone)) {
          void sendWhatsApp(senderPhone, replyVoiceProcessingAck());
        }
      }

      const outcome = await processInboundWAMessage(message, req.log);

      req.log.info(
        { outcomeKind: outcome.kind, source: "dm" },
        "360Dialog webhook outcome",
      );

      await handleWaOutcome(outcome, replyDest, req);
    } catch (err) {
      req.log.error({ err }, "360Dialog webhook processing failed");
    }
  },
);

/**
 * GET /api/webhook/whatsapp/info
 *
 * Returns webhook configuration info for the settings/casa UI.
 * Shows the active BSP and its webhook URL alongside legacy Twilio fields.
 */
router.get("/webhook/whatsapp/info", async (req: Request, res: Response) => {
  const adapter = getBspAdapter();
  const activeBsp = (process.env.WA_BSP ?? "twilio").toLowerCase();
  const bspConfigured = adapter.isConfigured();

  const domains = (process.env.REPLIT_DOMAINS ?? "").split(",").filter(Boolean);
  const primaryDomainStr = domains[0] ?? null;

  const webhookPath =
    activeBsp === "360dialog"
      ? "/api/webhook/whatsapp/360dialog"
      : "/api/webhook/whatsapp";

  // Legacy Twilio fields — kept for backward compat with any frontend that reads them.
  const rawFrom = process.env.TWILIO_WHATSAPP_FROM ?? "";
  const twilioNumber = rawFrom.replace(/^whatsapp:/i, "").replace(/\D/g, "") || null;

  res.json({
    webhook_url: primaryDomainStr ? `https://${primaryDomainStr}${webhookPath}` : null,
    method: "POST",
    description:
      activeBsp === "360dialog"
        ? "Configure este URL no painel da 360Dialog como webhook de entrada para o seu número WhatsApp Business."
        : "Configure este URL no console do Twilio como webhook de entrada para seu número WhatsApp Business.",
    status: primaryDomainStr ? "configured" : "needs_domain",
    bsp: activeBsp,
    bspConfigured,
    // Legacy fields
    twilioConfigured: isTwilioConfigured(),
    twilio_number: twilioNumber,
  });
});

export default router;
