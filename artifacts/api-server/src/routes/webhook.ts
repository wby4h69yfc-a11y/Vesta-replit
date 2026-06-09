import { Router, type Request, type Response } from "express";
import { isTwilioConfigured, sendWhatsApp } from "../lib/whatsapp";
import { resolveHouseholdAdminPhone } from "../lib/whatsapp";
import { processInboundWAMessage } from "../lib/wa-message-processor";
import { isGroupMessage, extractVestaTrigger } from "../lib/wa-group-trigger";
import { db } from "@workspace/db";
import { householdsTable, membersTable, onboardingStateTable, waConversationsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  replyVerificationSuccess,
  replyTokenExpired,
  replyIngestAck,
  replyActionProposal,
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
} from "../lib/wa-reply-composer";

const router = Router();

/**
 * Validates the X-Twilio-Signature HMAC header to confirm the POST came from
 * Twilio, not an impersonator.
 *
 * In development with no TWILIO_AUTH_TOKEN set we log a warning and permit
 * the request so local curl-based testing works. In production the env var
 * MUST be set — any request without a valid signature will be rejected.
 */
async function validateTwilioSignature(req: Request): Promise<boolean> {
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (process.env.NODE_ENV !== "production") {
    req.log.warn(
      "NODE_ENV !== production — skipping Twilio signature check (development mode)",
    );
    return true;
  }

  if (!authToken) {
    req.log.error(
      "TWILIO_AUTH_TOKEN not set in production — rejecting webhook request",
    );
    return false;
  }

  const signature = (req.headers["x-twilio-signature"] ?? "") as string;
  if (!signature) {
    req.log.warn("Webhook: missing X-Twilio-Signature header");
    return false;
  }

  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined)
      ?.split(",")[0]
      ?.trim() ?? "https";
  const host =
    (req.headers["x-forwarded-host"] as string | undefined)
      ?.split(",")[0]
      ?.trim() ??
    (req.headers["host"] as string | undefined) ??
    process.env.REPLIT_DEV_DOMAIN ??
    process.env.REPLIT_DOMAINS?.split(",")[0] ??
    "localhost";
  const webhookUrl = `${proto}://${host}/api/webhook/whatsapp`;

  const { validateRequest } = await import("twilio");
  const params = (req.body ?? {}) as Record<string, string>;
  return validateRequest(authToken, signature, webhookUrl, params);
}

/** Resolve the primary production domain for deep links. */
function primaryDomain(): string | null {
  const domains = (process.env.REPLIT_DOMAINS ?? "").split(",").filter(Boolean);
  return domains[0] ?? process.env.REPLIT_DEV_DOMAIN ?? null;
}

/**
 * POST /api/webhook/whatsapp
 *
 * Twilio WhatsApp inbound webhook.
 * Configure in Twilio Console → Messaging → Active Numbers → Webhook:
 *   POST https://<your-domain>/api/webhook/whatsapp
 *
 * Architecture:
 *   1. Authenticate (Twilio HMAC)
 *   2. ACK Twilio immediately (prevents retries)
 *   3. Delegate to WhatsAppMessageProcessor (async)
 *   4. Send WhatsApp reply based on WA-native routing decision
 *
 * WA-native approval loop (confidence ≥ 0.80, single-intent, no payment):
 *   • New message → classified → replyActionProposal (asks sim/não in WA)
 *   • "sim"           → replyApproved   (action written to DB, rotated vocab)
 *   • "não"           → replyDismissed
 *   • "editar: X"     → replyEdited     (title corrected and action written)
 *   • "sim mas X"     → replyNlEditProposal (re-proposes with updated title)
 *   • "desfazer"      → replyUndone     (30-min undo window)
 *
 * App-required path (confidence < 0.80 or cascade or payment or explicit):
 *   • replyAppDeepLink → user opens inbox in browser to review
 *   • explicit items also notify household admin
 */
router.post("/webhook/whatsapp", async (req: Request, res: Response) => {
  // ── 1. Authenticate ────────────────────────────────────────────────────────
  const isValid = await validateTwilioSignature(req);
  if (!isValid) {
    req.log.warn({ ip: req.ip }, "Webhook: invalid Twilio signature — rejected");
    res.status(403).send("Forbidden");
    return;
  }

  // ── 2. ACK Twilio immediately so it never retries on timeout ───────────────
  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  res.set("Content-Type", "text/xml");
  res.status(200).send(twiml);

  // ── 3. Process asynchronously (response already sent) ─────────────────────
  try {
    const {
      From,
      To,
      Body,
      ProfileName,
      MediaUrl0,
      MediaContentType0,
      NumMedia,
      MessageSid,
    } = req.body as Record<string, string | undefined>;

    // ── Group detection & /vesta trigger filter ────────────────────────────
    // For a WhatsApp group message Twilio sets `To` to the group JID
    // (e.g. "whatsapp:+12036XXXXXXXX@g.us"), whereas for a direct message it
    // is the Twilio number. The "@g.us" suffix is the canonical group signal.
    // We store the raw `To` value as group_id for logging and reply routing.
    const rawTo = To ?? "";
    const groupSourced = isGroupMessage(rawTo);
    // group_id is the raw To value — sendWhatsApp handles the whatsapp: prefix.
    const groupId = groupSourced ? rawTo : null;

    let effectiveBody = Body?.trim() ?? "";
    if (groupSourced) {
      const stripped = extractVestaTrigger(effectiveBody);
      if (stripped === null) {
        req.log.info(
          { group_id: groupId, from: From, source: "group" },
          "Group message without /vesta trigger — silently ignored",
        );
        return;
      }
      // Use the stripped body so downstream processing is identical to a DM.
      effectiveBody = stripped;
      req.log.info(
        { group_id: groupId, from: From, preview: effectiveBody.substring(0, 60), source: "group" },
        "Group /vesta command received",
      );
    }

    // Replies go to the group JID for group messages so all members see the
    // response, or to the sender's phone for direct messages.
    const replyDest = (phone: string): string => groupId ?? phone;

    // ── Tier-0: PAUSAR / PARAR / RETOMAR keywords ──────────────────────────
    // These are handled before the normal message processor to give users
    // immediate control over proactive messages without any AI involvement.
    const normalizedBody = effectiveBody.toUpperCase();
    const isPausar = normalizedBody === "PAUSAR";
    const isParar = normalizedBody === "PARAR";
    const isRetomar = normalizedBody === "RETOMAR";

    if (isPausar || isParar || isRetomar) {
      const senderPhone = (From ?? "").replace(/^whatsapp:/i, "");

      // ── DM-only gate for Tier-0 commands ─────────────────────────────────
      // PAUSAR/PARAR/RETOMAR mutate household digest state, so they follow the
      // same principle as mutation commands: group chats are blocked entirely
      // and the sender is redirected to a private DM.  This is also simpler
      // than the earlier per-role admin gate and consistent with the processor-
      // level group mutation gate in processInboundWAMessage.
      if (groupSourced) {
        void sendWhatsApp(groupId!, replyGroupMutationBlocked());
        req.log.info(
          { senderPhone, group_id: groupId, command: normalizedBody, source: "group" },
          "Group Tier-0 command rejected — DM-only",
        );
        return;
      }

      // Resolve household from verified phone
      const [onboarding] = await db
        .select({ household_id: onboardingStateTable.household_id })
        .from(onboardingStateTable)
        .where(eq(onboardingStateTable.whatsapp_verified_phone, senderPhone))
        .limit(1);

      if (onboarding) {
        if (isPausar) {
          const pausedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
          await db
            .update(householdsTable)
            .set({ digest_paused_until: pausedUntil, digest_stopped: false })
            .where(eq(householdsTable.id, onboarding.household_id));
          void sendWhatsApp(replyDest(senderPhone), "⏸ Pausei por 24h. Manda *RETOMAR* pra voltar.");
        } else if (isParar) {
          await db
            .update(householdsTable)
            .set({ digest_stopped: true, digest_paused_until: null })
            .where(eq(householdsTable.id, onboarding.household_id));
          void sendWhatsApp(replyDest(senderPhone), "🔕 Parei. Manda *RETOMAR* pra voltar.");
        } else {
          await db
            .update(householdsTable)
            .set({ digest_stopped: false, digest_paused_until: null, digest_enabled: true })
            .where(eq(householdsTable.id, onboarding.household_id));
          void sendWhatsApp(replyDest(senderPhone), "▶️ Retomado! Você voltará a receber os resumos diários.");
        }
        req.log.info(
          { senderPhone, command: normalizedBody, householdId: onboarding.household_id, source: groupSourced ? "group" : "dm" },
          "Proactive command processed",
        );
      }
      return; // do not continue to normal message processing
    }

    const outcome = await processInboundWAMessage(
      {
        from: From ?? "",
        body: effectiveBody,
        profileName: ProfileName ?? null,
        mediaUrl: MediaUrl0 ?? null,
        mediaContentType: MediaContentType0 ?? null,
        numMedia: NumMedia ?? null,
        messageSid: MessageSid ?? null,
        groupId: groupId ?? null,
      },
      req.log,
    );

    // ── 4. Send reply based on outcome ──────────────────────────────────────
    // Tag every outcome log with source + group_id so group-origin events are
    // distinguishable from direct messages throughout the API logs.
    req.log.info(
      {
        outcomeKind: outcome.kind,
        source: groupSourced ? "group" : "dm",
        ...(groupId ? { group_id: groupId } : {}),
      },
      "WhatsApp webhook outcome",
    );

    switch (outcome.kind) {
      case "token_verified":
        void sendWhatsApp(replyDest(outcome.phone), replyVerificationSuccess());
        break;

      case "token_expired":
        void sendWhatsApp(replyDest(outcome.phone), replyTokenExpired());
        break;

      // ── WhatsApp group: non-admin tried /vesta ─────────────────────────────
      case "group_non_admin":
        void sendWhatsApp(outcome.groupId, replyGroupNonAdmin());
        req.log.info(
          { groupId: outcome.groupId, phone: outcome.phone, source: "group" },
          "Group /vesta command rejected — non-admin sender",
        );
        break;

      // ── WhatsApp group: admin issued a mutation command ────────────────────
      // Mutation commands (cancela, cria, apaga, …) require the multi-turn
      // approval loop, which is not safe in a shared group thread. We reply
      // with a friendly redirect so the admin knows to use a DM instead.
      case "group_mutation_blocked":
        void sendWhatsApp(outcome.groupId, replyGroupMutationBlocked());
        req.log.info(
          { groupId: outcome.groupId, phone: outcome.phone, source: "group" },
          "Group /vesta mutation command blocked — redirect to DM sent",
        );
        break;

      // ── WhatsApp-native approval responses ─────────────────────────────────
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

      // NL / structured edit applied — re-propose updated item for final confirmation
      case "nl_edit_proposed_via_wa":
        void sendWhatsApp(replyDest(outcome.phone), replyNlEditProposal(outcome.newTitle));
        req.log.info({ actionId: outcome.actionId, newTitle: outcome.newTitle }, "Edit re-proposed via WhatsApp");
        break;

      case "undone_via_wa":
        void sendWhatsApp(replyDest(outcome.phone), replyUndone(outcome.actionTitle));
        break;

      case "consent_updated": {
        // Consent replies go to the sender directly, not to a group (consent
        // flows are always 1:1 DMs between the contact and Vesta).
        void sendWhatsApp(
          outcome.phone,
          outcome.newStatus === "consented" ? replyConsentGranted() : replyConsentRevoked(),
        );
        req.log.info(
          { contactId: outcome.contactId, newStatus: outcome.newStatus },
          "Consent updated via WhatsApp reply — ack sent",
        );

        // Notify the household admin so they know the consent loop closed
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

      // ── New inbound message — classified and routed ────────────────────────
      case "ingested": {
        if (!outcome.consentGranted) break;

        if (!outcome.actionTitle) {
          // Classification produced no action (e.g. pure chitchat) — simple ack
          void sendWhatsApp(replyDest(outcome.phone), replyIngestAck());
          break;
        }

        const domain = primaryDomain();

        if (outcome.waCanApproveViaWa) {
          // High-confidence single-intent: propose inline in WhatsApp
          req.log.info(
            { actionId: outcome.actionId, confidence: outcome.confidence },
            "WA-native flow: sending inline action proposal",
          );
          void sendWhatsApp(
            replyDest(outcome.phone),
            replyActionProposal(
              outcome.actionTitle,
              outcome.actionType,
              outcome.actionCategory,
              outcome.actionDatetime,
            ),
          );
        } else {
          // Low-confidence, multi-intent, payment, or explicit: redirect to app
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

        // Notify household admin for explicit-approval items regardless of routing.
        // Admin notifications are always DMs, not group replies.
        if (outcome.approvalLevel === "explicit" && outcome.senderName) {
          const adminPhone = await resolveHouseholdAdminPhone(outcome.householdId);
          if (adminPhone && adminPhone !== outcome.phone) {
            void sendWhatsApp(
              adminPhone,
              replyExplicitReviewNeeded(outcome.senderName),
            );
          }
        }
        break;
      }

      case "provider_rated": {
        const { contactId, contactName, rating, noShowCount, suggestUpgrade, suggestAvoid, householdId: ratedHhId, phone: ratedPhone } = outcome;
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
          const upgradeExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
          void db.insert(waConversationsTable).values({
            household_id: ratedHhId,
            sender_phone: ratedPhone,
            state: "awaiting_confirmation",
            thread_context: "suggest_preferred",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            proposed_payload: { contact_id: contactId, contact_name: contactName } as any,
            expires_at: upgradeExpiresAt,
          });
        }

        if (suggestAvoid) {
          const avoidExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
          void db.insert(waConversationsTable).values({
            household_id: ratedHhId,
            sender_phone: ratedPhone,
            state: "awaiting_confirmation",
            thread_context: "avoid_confirm",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            proposed_payload: { contact_id: contactId, contact_name: contactName } as any,
            expires_at: avoidExpiresAt,
          });
        }

        req.log.info(
          { contactName, rating, noShowCount, suggestUpgrade, suggestAvoid },
          "Provider rated — WA ack sent",
        );
        break;
      }

      case "avoid_confirmed": {
        const { contactName, phone: avoidPhone } = outcome;
        void sendWhatsApp(replyDest(avoidPhone), replyAvoidConfirmed(contactName));
        req.log.info({ contactName }, "Provider marked as avoid — WA confirmed");
        break;
      }

      case "avoid_cancelled": {
        const { contactName, phone: avoidPhone } = outcome;
        void sendWhatsApp(replyDest(avoidPhone), replyAvoidCancelled(contactName));
        req.log.info({ contactName }, "Avoid marking cancelled by admin");
        break;
      }

      case "promoted_to_preferred": {
        const { contactName, phone: prefPhone } = outcome;
        void sendWhatsApp(replyDest(prefPhone), replyPreferredPromoted(contactName));
        req.log.info({ contactName }, "Provider promoted to preferred — WA ack sent");
        break;
      }

      case "suggest_preferred_declined": {
        const { contactName, phone: prefPhone } = outcome;
        void sendWhatsApp(replyDest(prefPhone), replyPreferredDeclined(contactName));
        req.log.info({ contactName }, "Preferred upgrade declined by admin");
        break;
      }

      case "question_answered":
        void sendWhatsApp(replyDest(outcome.phone), outcome.reply);
        req.log.info(
          { householdId: outcome.householdId, preview: outcome.reply.substring(0, 80) },
          "Q&A reply sent to admin via WhatsApp",
        );
        break;

      // ── Mutation intent proposal ───────────────────────────────────────────
      // A DM admin sent a mutation command; the handler parsed it, found the
      // target entity, and stored a mutation_confirm conversation. Send the
      // proposal message so the admin can confirm with sim/não.
      case "mutation_proposed_via_wa":
        void sendWhatsApp(replyDest(outcome.phone), replyMutationProposal(outcome.proposal));
        req.log.info(
          { householdId: outcome.householdId, preview: outcome.proposal.substring(0, 80) },
          "Mutation proposal sent to admin via WhatsApp",
        );
        break;

      // ── Mutation executed ─────────────────────────────────────────────────
      // Admin replied "sim" — the mutation was applied and audited.
      case "mutation_executed_via_wa":
        void sendWhatsApp(replyDest(outcome.phone), replyMutationExecuted(outcome.description));
        req.log.info(
          { householdId: outcome.householdId, description: outcome.description },
          "Mutation executed via WhatsApp — confirmation sent",
        );
        break;

      // ── Mutation dismissed ────────────────────────────────────────────────
      // Admin replied "não" — the pending mutation was discarded.
      case "mutation_dismissed_via_wa":
        void sendWhatsApp(replyDest(outcome.phone), replyMutationDismissed());
        req.log.info(
          { householdId: outcome.householdId },
          "Mutation proposal dismissed by admin",
        );
        break;

      // ── Mutation error ────────────────────────────────────────────────────
      // Handler could not parse the command or find the target entity.
      // Send the error reply so the admin knows what went wrong.
      case "mutation_error_via_wa":
        void sendWhatsApp(replyDest(outcome.phone), replyMutationError(outcome.reply));
        req.log.info(
          { householdId: outcome.householdId, preview: outcome.reply.substring(0, 80) },
          "Mutation error reply sent to admin via WhatsApp",
        );
        break;

      // ── WhatsApp-native onboarding ─────────────────────────────────────────
      // New user — never registered in any household. Route through the
      // conversational onboarding flow. The handler builds the reply text.
      case "wa_onboarding":
        void sendWhatsApp(outcome.phone, outcome.reply);
        req.log.info(
          { phone: outcome.phone, preview: outcome.reply.substring(0, 80) },
          "WA onboarding reply sent",
        );
        break;

      case "unknown_sender":
      case "multi_household":
      case "duplicate":
      case "empty_message":
      case "media_rate_limited":
        // No reply — do not confirm to unknown/spam senders that the number is active
        break;
    }
  } catch (err) {
    req.log.error({ err }, "WhatsApp webhook processing failed");
    // Do NOT re-throw — Twilio response already sent
  }
});

/**
 * GET /api/webhook/whatsapp/info
 *
 * Returns webhook configuration info for the settings/casa UI.
 */
router.get("/webhook/whatsapp/info", async (req: Request, res: Response) => {
  const domains = (process.env.REPLIT_DOMAINS ?? "").split(",").filter(Boolean);
  const primaryDomainStr = domains[0] ?? null;

  // Extract the phone number digits from TWILIO_WHATSAPP_FROM (e.g. "whatsapp:+14155238886" → "14155238886")
  const rawFrom = process.env.TWILIO_WHATSAPP_FROM ?? "";
  const twilioNumber = rawFrom.replace(/^whatsapp:/i, "").replace(/\D/g, "") || null;

  res.json({
    webhook_url: primaryDomainStr
      ? `https://${primaryDomainStr}/api/webhook/whatsapp`
      : null,
    method: "POST",
    description:
      "Configure este URL no console do Twilio como webhook de entrada para seu número WhatsApp Business.",
    status: primaryDomainStr ? "configured" : "needs_domain",
    twilioConfigured: isTwilioConfigured(),
    twilio_number: twilioNumber,
  });
});

export default router;
