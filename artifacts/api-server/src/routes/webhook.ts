import { Router, type Request, type Response } from "express";
import { isTwilioConfigured, sendWhatsApp } from "../lib/whatsapp";
import { resolveHouseholdAdminPhone } from "../lib/whatsapp";
import { processInboundWAMessage } from "../lib/wa-message-processor";
import {
  replyVerificationSuccess,
  replyTokenExpired,
  replyIngestAck,
  replyExplicitReviewNeeded,
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
 *   4. Send WhatsApp reply via WhatsAppReplyComposer output
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

      case "ingested": {
        // ACK sender (LGPD: only when consent allows)
        if (outcome.consentGranted) {
          void sendWhatsApp(outcome.phone, replyIngestAck());
        }

        // Notify household admin for explicit-approval items
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
  const primaryDomain = domains[0] ?? null;

  // Extract the phone number digits from TWILIO_WHATSAPP_FROM (e.g. "whatsapp:+14155238886" → "14155238886")
  const rawFrom = process.env.TWILIO_WHATSAPP_FROM ?? "";
  const twilioNumber = rawFrom.replace(/^whatsapp:/i, "").replace(/\D/g, "") || null;

  res.json({
    webhook_url: primaryDomain
      ? `https://${primaryDomain}/api/webhook/whatsapp`
      : null,
    method: "POST",
    description:
      "Configure este URL no console do Twilio como webhook de entrada para seu número WhatsApp Business.",
    status: primaryDomain ? "configured" : "needs_domain",
    twilioConfigured: isTwilioConfigured(),
    twilio_number: twilioNumber,
  });
});

export default router;
