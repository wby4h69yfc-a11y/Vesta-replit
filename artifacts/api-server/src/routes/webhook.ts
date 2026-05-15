import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { inboxItemsTable, contactsTable, membersTable } from "@workspace/db";
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
 *
 * Household routing: the sender's phone number is matched against known
 * contacts and members to identify which household should receive the
 * message. Unknown senders are discarded to prevent cross-tenant pollution.
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

    if (!phoneRaw) {
      req.log.warn({ MessageSid }, "WhatsApp webhook: no sender phone — discarding");
      return;
    }

    // Normalize: last 8 digits for loose matching across country code formats
    const normalized = (p: string) => p.replace(/\D/g, "").slice(-8);
    const phoneNorm = normalized(phoneRaw);

    // ── Resolve household from sender phone ────────────────────────────────
    // Priority: contacts table (explicit contact), then members table (household adults)
    let householdId: number | null = null;
    let resolvedSenderName: string | null = ProfileName ?? null;

    // 1. Search contacts
    const allContacts = await db
      .select({ id: contactsTable.id, name: contactsTable.name, phone: contactsTable.phone, household_id: contactsTable.household_id })
      .from(contactsTable);

    const matchedContact = allContacts.find(
      (c) => c.phone && normalized(c.phone) === phoneNorm,
    );

    if (matchedContact) {
      householdId = matchedContact.household_id;
      resolvedSenderName = matchedContact.name;
      req.log.info({ contact: matchedContact.name, householdId }, "Webhook: matched sender to contact");
    } else {
      // 2. Search members as fallback
      const allMembers = await db
        .select({ name: membersTable.name, phone: membersTable.phone, household_id: membersTable.household_id })
        .from(membersTable);

      const matchedMember = allMembers.find(
        (m) => m.phone && normalized(m.phone) === phoneNorm,
      );

      if (matchedMember) {
        householdId = matchedMember.household_id;
        resolvedSenderName = matchedMember.name;
        req.log.info({ member: matchedMember.name, householdId }, "Webhook: matched sender to member");
      }
    }

    // Discard messages from unrecognised senders to prevent cross-tenant pollution.
    // The household admin must first add the sender's number as a contact.
    if (!householdId) {
      req.log.warn({ phone: phoneRaw, ProfileName }, "Webhook: unknown sender — discarding to prevent cross-tenant pollution");
      return;
    }

    // Determine source and media
    const hasMedia = parseInt(NumMedia ?? "0", 10) > 0;
    const source = hasMedia ? "photo" : "whatsapp";
    const rawContent = Body?.trim() ?? "(mídia recebida)";

    // Create inbox item scoped to the resolved household
    const [item] = await db
      .insert(inboxItemsTable)
      .values({
        household_id: householdId,
        source,
        raw_content: rawContent,
        media_url: MediaUrl0 ?? null,
        status: "classifying",
        sender_name: resolvedSenderName,
        twilio_message_sid: MessageSid ?? null,
      })
      .returning();

    req.log.info({ inboxItemId: item.id, sender: resolvedSenderName, householdId }, "WhatsApp message ingested");

    // Fire acknowledgement back to sender (fire-and-forget — response already sent)
    void sendWhatsApp(
      phoneRaw,
      "✓ Mensagem recebida! Vou analisar e avisar você em breve.",
    ).then((result) => {
      if (!result.ok) {
        req.log.warn({ error: result.error, phone: phoneRaw }, "ACK send failed");
      }
    });

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
