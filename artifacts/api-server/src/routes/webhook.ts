import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { inboxItemsTable, contactsTable, membersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { classifyAndSaveAction } from "../lib/classifier";
import { sendWhatsApp, isTwilioConfigured } from "../lib/whatsapp";

const router = Router();

/**
 * Validates the X-Twilio-Signature HMAC header to confirm the POST came from
 * Twilio, not an impersonator.
 *
 * Twilio computes HMAC-SHA1 over (URL + sorted key=value pairs) using the
 * account's auth token. We recompute the same digest and compare.
 *
 * In development with no TWILIO_AUTH_TOKEN set we log a warning and permit
 * the request so local curl-based testing works. In production the env var
 * MUST be set — any request without a valid signature will be rejected.
 */
async function validateTwilioSignature(req: Request): Promise<boolean> {
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!authToken) {
    // In production a missing auth token is a misconfiguration — fail closed.
    if (process.env.NODE_ENV === "production") {
      req.log.error(
        "TWILIO_AUTH_TOKEN not set in production — rejecting webhook request",
      );
      return false;
    }
    // In development, permit unauthenticated requests so curl-based local
    // testing works, but log a prominent warning.
    req.log.warn(
      "TWILIO_AUTH_TOKEN not set — skipping signature check (dev only, will fail in production)",
    );
    return true;
  }

  const signature = (req.headers["x-twilio-signature"] ?? "") as string;
  if (!signature) {
    req.log.warn("Webhook: missing X-Twilio-Signature header");
    return false;
  }

  // Reconstruct the full public URL Twilio signed.
  // In production REPLIT_DOMAINS is set; fall back to forwarded host in other envs.
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
  const proto = req.headers["x-forwarded-proto"] ?? "https";
  const host = req.headers["x-forwarded-host"] ?? req.headers["host"] ?? "localhost";
  const webhookUrl = domain
    ? `https://${domain}/api/webhook/whatsapp`
    : `${proto}://${host}/api/webhook/whatsapp`;

  // Twilio SDK's validateRequest performs the HMAC-SHA1 comparison.
  const { validateRequest } = await import("twilio");
  const params = (req.body ?? {}) as Record<string, string>;
  return validateRequest(authToken, signature, webhookUrl, params);
}

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
 * Security: requests are validated against the X-Twilio-Signature HMAC before
 * any database read or write is performed. Spoofed requests receive 403 and
 * are logged but do not reach the ingestion path.
 *
 * Household routing: the sender's phone number is matched against known
 * contacts and members to identify which household should receive the
 * message. Unknown senders are discarded to prevent cross-tenant pollution.
 */
router.post("/webhook/whatsapp", async (req: Request, res: Response) => {
  // ── 1. Authenticate the request before touching the DB ─────────────────────
  const isValid = await validateTwilioSignature(req);
  if (!isValid) {
    req.log.warn(
      { ip: req.ip },
      "Webhook: invalid Twilio signature — request rejected",
    );
    res.status(403).send("Forbidden");
    return;
  }

  // ── 2. ACK Twilio immediately so it never retries due to a timeout ─────────
  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  res.set("Content-Type", "text/xml");
  res.status(200).send(twiml);

  // ── 3. Process the message asynchronously (response already sent) ───────────
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
      req.log.info(
        { MessageSid },
        "WhatsApp webhook: empty body and no media — skipping",
      );
      return;
    }

    // Deduplicate: Twilio may retry on timeout; skip if we already ingested
    // this MessageSid to prevent duplicate inbox items.
    if (MessageSid) {
      const [existing] = await db
        .select({ id: inboxItemsTable.id })
        .from(inboxItemsTable)
        .where(and(eq(inboxItemsTable.twilio_message_sid, MessageSid)))
        .limit(1);

      if (existing) {
        req.log.info(
          { MessageSid },
          "Webhook: duplicate MessageSid — already ingested, skipping",
        );
        return;
      }
    }

    // Strip the "whatsapp:" prefix from From number
    const phoneRaw = From?.replace(/^whatsapp:/i, "").trim() ?? null;

    if (!phoneRaw) {
      req.log.warn({ MessageSid }, "WhatsApp webhook: no sender phone — discarding");
      return;
    }

    // Normalise: strip all non-digit characters and compare the full number.
    // Partial-digit matching (e.g. last 8 digits) is intentionally avoided
    // because it allows numbers from different area codes or countries to
    // collide, enabling an attacker to inject messages into another
    // household's inbox.  Exact normalised matching is required.
    const normalized = (p: string) => p.replace(/\D/g, "");
    const phoneNorm = normalized(phoneRaw);

    // ── Resolve household from sender phone ──────────────────────────────────
    // Priority: contacts table (explicit contact), then members table (household adults)
    let householdId: number | null = null;
    let resolvedSenderName: string | null = ProfileName ?? null;

    // 1. Search contacts across all households
    const allContacts = await db
      .select({
        id: contactsTable.id,
        name: contactsTable.name,
        phone: contactsTable.phone,
        household_id: contactsTable.household_id,
      })
      .from(contactsTable);

    const matchedContact = allContacts.find(
      (c) => c.phone && normalized(c.phone) === phoneNorm,
    );

    if (matchedContact) {
      householdId = matchedContact.household_id;
      resolvedSenderName = matchedContact.name;
      req.log.info(
        { contact: matchedContact.name, householdId },
        "Webhook: matched sender to contact",
      );
    } else {
      // 2. Search members as fallback
      const allMembers = await db
        .select({
          name: membersTable.name,
          phone: membersTable.phone,
          household_id: membersTable.household_id,
        })
        .from(membersTable);

      const matchedMember = allMembers.find(
        (m) => m.phone && normalized(m.phone) === phoneNorm,
      );

      if (matchedMember) {
        householdId = matchedMember.household_id;
        resolvedSenderName = matchedMember.name;
        req.log.info(
          { member: matchedMember.name, householdId },
          "Webhook: matched sender to member",
        );
      }
    }

    // Discard messages from unrecognised senders to prevent cross-tenant
    // pollution. The household admin must first add the sender's number as a
    // contact before messages are ingested.
    if (!householdId) {
      req.log.warn(
        { phone: phoneRaw, ProfileName },
        "Webhook: unknown sender — discarding to prevent cross-tenant pollution",
      );
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

    req.log.info(
      { inboxItemId: item.id, sender: resolvedSenderName, householdId },
      "WhatsApp message ingested",
    );

    // Fire acknowledgement back to sender (fire-and-forget — response already sent)
    void sendWhatsApp(
      phoneRaw,
      "✓ Mensagem recebida! Vou analisar e avisar você em breve.",
    ).then((result) => {
      if (!result.ok) {
        req.log.warn(
          { error: result.error, phone: phoneRaw },
          "ACK send failed",
        );
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
router.get(
  "/webhook/whatsapp/info",
  async (req: Request, res: Response) => {
    const domains = (process.env.REPLIT_DOMAINS ?? "")
      .split(",")
      .filter(Boolean);
    const primaryDomain = domains[0] ?? null;

    res.json({
      webhook_url: primaryDomain
        ? `https://${primaryDomain}/api/webhook/whatsapp`
        : null,
      method: "POST",
      description:
        "Configure este URL no console do Twilio como webhook de entrada para seu número WhatsApp Business.",
      status: primaryDomain ? "configured" : "needs_domain",
      twilioConfigured: isTwilioConfigured(),
    });
  },
);

export default router;
