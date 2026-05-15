import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { inboxItemsTable, contactsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { classifyAndSaveAction } from "../lib/classifier";
import { sendWhatsApp, isTwilioConfigured } from "../lib/whatsapp";

const router = Router();

/**
 * Twilio WhatsApp inbound webhook.
 *
 * Configure in Twilio Console → Messaging → Active Numbers → Webhook:
 *   POST https://<your-domain>/api/webhook/whatsapp
 *
 * Twilio sends application/x-www-form-urlencoded with these key fields:
 *   From        — sender number, e.g. "whatsapp:+5511999990001"
 *   Body        — message text
 *   ProfileName — WhatsApp display name of sender
 *   MediaUrl0   — URL of first media attachment (if any)
 *   NumMedia    — count of media attachments
 *   MessageSid  — unique Twilio message ID
 *
 * The webhook always returns a 200 with empty TwiML so Twilio doesn't retry.
 * Classification happens async after the response is sent.
 */
router.post("/webhook/whatsapp", async (req: Request, res: Response) => {
  // Always ACK Twilio immediately — never let it time out
  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  res.set("Content-Type", "text/xml");
  res.status(200).send(twiml);

  try {
    const {
      From,
      Body,
      ProfileName,
      MediaUrl0,
      NumMedia,
      MessageSid,
    } = req.body as {
      From?: string;
      Body?: string;
      ProfileName?: string;
      MediaUrl0?: string;
      NumMedia?: string;
      MessageSid?: string;
    };

    // Require at least some content
    if (!Body && !MediaUrl0) {
      req.log.info({ MessageSid }, "WhatsApp webhook: empty body and no media — skipping");
      return;
    }

    // Strip the "whatsapp:" prefix from From number
    const phoneRaw = From?.replace(/^whatsapp:/i, "").trim() ?? null;

    // Look up sender in contacts by phone number or profile name
    let resolvedSenderName: string | null = ProfileName ?? null;

    if (phoneRaw) {
      // Normalize: strip country code formatting for loose matching
      const contacts = await db
        .select()
        .from(contactsTable)
        .where(eq(contactsTable.household_id, 1));

      const normalized = (p: string) => p.replace(/\D/g, "").slice(-8);
      const phoneNorm = normalized(phoneRaw);

      const match = contacts.find(
        (c) => c.phone && normalized(c.phone) === phoneNorm,
      );
      if (match) {
        resolvedSenderName = match.name;
        req.log.info({ contact: match.name }, "Matched WhatsApp sender to contact");
      }
    }

    // Determine source and media
    const hasMedia = parseInt(NumMedia ?? "0", 10) > 0;
    const source = hasMedia ? "photo" : "whatsapp";
    const rawContent = Body?.trim() ?? "(mídia recebida)";

    // Create inbox item
    const [item] = await db
      .insert(inboxItemsTable)
      .values({
        household_id: 1,
        source,
        raw_content: rawContent,
        media_url: MediaUrl0 ?? null,
        status: "classifying",
        sender_name: resolvedSenderName,
        twilio_message_sid: MessageSid ?? null,
      })
      .returning();

    req.log.info({ inboxItemId: item.id, sender: resolvedSenderName }, "WhatsApp message ingested");

    // Fire acknowledgement back to sender (fire-and-forget — response already sent)
    if (phoneRaw) {
      void sendWhatsApp(
        phoneRaw,
        "✓ Mensagem recebida! Vou analisar e avisar você em breve.",
      ).then((result) => {
        if (!result.ok) {
          req.log.warn({ error: result.error, phone: phoneRaw }, "ACK send failed");
        }
      });
    }

    // Run classifier asynchronously so response was already sent
    await classifyAndSaveAction(item.id);

    req.log.info({ inboxItemId: item.id }, "WhatsApp message classified");
  } catch (err) {
    req.log.error({ err }, "WhatsApp webhook processing failed");
    // Do NOT re-throw — response already sent
  }
});

/**
 * GET /api/webhook/whatsapp — returns webhook info for the settings UI.
 */
router.get("/webhook/whatsapp/info", async (req: Request, res: Response) => {
  const domains = (process.env.REPLIT_DOMAINS ?? "").split(",").filter(Boolean);
  const primaryDomain = domains[0] ?? null;

  res.json({
    webhook_url: primaryDomain
      ? `https://${primaryDomain}/api/webhook/whatsapp`
      : null,
    method: "POST",
    description: "Configure este URL no console do Twilio como webhook de entrada para seu número WhatsApp Business.",
    status: primaryDomain ? "configured" : "needs_domain",
    twilioConfigured: isTwilioConfigured(),
  });
});

export default router;
