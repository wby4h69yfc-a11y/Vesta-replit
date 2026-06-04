import { Router, type Request, type Response } from "express";
import { isTwilioConfigured, sendWhatsApp } from "../lib/whatsapp";
import { resolveHouseholdAdminPhone } from "../lib/whatsapp";
import { processInboundWAMessage } from "../lib/wa-message-processor";
import {
  replyVerificationSuccess,
  replyTokenExpired,
  replyIngestAck,
  replyActionProposal,
  replyApproved,
  replyDismissed,
  replyEdited,
  replyNlEditProposal,
  replyUndone,
  replyExplicitReviewNeeded,
  replyAppDeepLink,
  replyConsentGranted,
  replyConsentRevoked,
  notifyAdminConsentGranted,
  notifyAdminConsentRevoked,
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

/**
 * WA-native routing decision per spec §20.3.
 *
 * Returns true when the item can be fully approved/rejected inside WhatsApp
 * without opening the app. Criteria (all must be true):
 *   • Classifier confidence ≥ 0.80
 *   • Not a multi-intent / cascade item
 *   • No payment recipient involved (workflow_tags excludes payment_admin)
 *   • Not explicit-approval level (medical, financial)
 *
 * When false, Vesta sends an app deep link instead of an inline proposal.
 */
function isWaNative(outcome: {
  confidence: number;
  cascadeCheckNeeded: boolean;
  workflowTags: string[];
  approvalLevel: string;
}): boolean {
  return (
    outcome.confidence >= 0.80 &&
    !outcome.cascadeCheckNeeded &&
    !outcome.workflowTags.includes("payment_admin") &&
    outcome.approvalLevel !== "explicit"
  );
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
      Body,
      ProfileName,
      MediaUrl0,
      MediaContentType0,
      NumMedia,
      MessageSid,
    } = req.body as Record<string, string | undefined>;

    const outcome = await processInboundWAMessage(
      {
        from: From ?? "",
        body: Body?.trim() ?? "",
        profileName: ProfileName ?? null,
        mediaUrl: MediaUrl0 ?? null,
        mediaContentType: MediaContentType0 ?? null,
        numMedia: NumMedia ?? null,
        messageSid: MessageSid ?? null,
      },
      req.log,
    );

    // ── 4. Send reply based on outcome ──────────────────────────────────────
    switch (outcome.kind) {
      case "token_verified":
        void sendWhatsApp(outcome.phone, replyVerificationSuccess());
        break;

      case "token_expired":
        void sendWhatsApp(outcome.phone, replyTokenExpired());
        break;

      // ── WhatsApp-native approval responses ─────────────────────────────────
      case "approved_via_wa":
        void sendWhatsApp(outcome.phone, replyApproved(outcome.actionTitle));
        req.log.info({ actionId: outcome.actionId }, "Sent approved reply via WhatsApp");
        break;

      case "dismissed_via_wa":
        void sendWhatsApp(outcome.phone, replyDismissed());
        break;

      case "edited_via_wa":
        void sendWhatsApp(outcome.phone, replyEdited(outcome.newTitle));
        break;

      // NL inline edit applied — re-propose updated item for final confirmation
      case "nl_edit_proposed_via_wa":
        void sendWhatsApp(outcome.phone, replyNlEditProposal(outcome.newTitle));
        req.log.info({ actionId: outcome.actionId, newTitle: outcome.newTitle }, "NL edit re-proposed via WhatsApp");
        break;

      case "undone_via_wa":
        void sendWhatsApp(outcome.phone, replyUndone(outcome.actionTitle));
        break;

      case "consent_updated": {
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
          void sendWhatsApp(outcome.phone, replyIngestAck());
          break;
        }

        const domain = primaryDomain();

        if (isWaNative(outcome)) {
          // High-confidence single-intent: propose inline in WhatsApp
          req.log.info(
            { actionId: outcome.actionId, confidence: outcome.confidence },
            "WA-native flow: sending inline action proposal",
          );
          void sendWhatsApp(
            outcome.phone,
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
          void sendWhatsApp(outcome.phone, replyAppDeepLink(outcome.actionTitle, domain));
        }

        // Notify household admin for explicit-approval items regardless of routing
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
