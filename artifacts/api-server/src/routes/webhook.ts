import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { inboxItemsTable, contactsTable, membersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { classifyAndSaveAction } from "../lib/classifier";
import { sendWhatsApp, isTwilioConfigured } from "../lib/whatsapp";
import { processWhatsAppMedia } from "../lib/media-analysis";
import { looksLikeToken, markTokenVerified } from "../lib/wa-token-store";

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
    if (process.env.NODE_ENV === "production") {
      req.log.error(
        "TWILIO_AUTH_TOKEN not set in production — rejecting webhook request",
      );
      return false;
    }
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

  // Reconstruct the exact URL Twilio signed. Twilio signs with the URL it
  // actually POSTed to — the externally-visible domain, not any internal address.
  // We read x-forwarded-proto / x-forwarded-host set by Replit's reverse proxy
  // rather than REPLIT_DOMAINS (which is the *production* domain and would
  // mismatch when testing against the dev preview URL).
  const proto = (req.headers["x-forwarded-proto"] as string | undefined)
    ?.split(",")[0]?.trim() ?? "https";
  const host = (req.headers["x-forwarded-host"] as string | undefined)
    ?.split(",")[0]?.trim()
    ?? (req.headers["host"] as string | undefined)
    ?? process.env.REPLIT_DEV_DOMAIN
    ?? process.env.REPLIT_DOMAINS?.split(",")[0]
    ?? "localhost";
  const webhookUrl = `${proto}://${host}/api/webhook/whatsapp`;

  // Debug: log headers and reconstructed URL so we can compare against Twilio's signature
  req.log.info({
    webhookUrl,
    "x-forwarded-proto": req.headers["x-forwarded-proto"],
    "x-forwarded-host": req.headers["x-forwarded-host"],
    "x-forwarded-for": req.headers["x-forwarded-for"],
    host: req.headers["host"],
    REPLIT_DEV_DOMAIN: process.env.REPLIT_DEV_DOMAIN,
    REPLIT_DOMAINS: process.env.REPLIT_DOMAINS,
    signaturePresent: !!signature,
    bodyKeys: Object.keys(req.body ?? {}),
  }, "Webhook: signature debug");

  const { validateRequest } = await import("twilio");
  const params = (req.body ?? {}) as Record<string, string>;
  return validateRequest(authToken, signature, webhookUrl, params);
}

/**
 * Twilio WhatsApp inbound webhook.
 *
 * Configure in Twilio Console → Messaging → Active Numbers → Webhook:
 *   POST https://<your-domain>/api/webhook/whatsapp
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
      MediaContentType0,
      NumMedia,
      MessageSid,
    } = req.body as {
      From?: string;
      Body?: string;
      ProfileName?: string;
      MediaUrl0?: string;
      MediaContentType0?: string;
      NumMedia?: string;
      MessageSid?: string;
    };

    const bodyText = Body?.trim() ?? "";

    // ── 3a. Onboarding token verification ─────────────────────────────────────
    // If the message is just a VESTA-XXX token, it's a WhatsApp verification
    // from the onboarding flow. Mark it verified and reply — don't create an
    // inbox item.
    if (looksLikeToken(bodyText)) {
      const userId = markTokenVerified(bodyText);
      const phoneRaw = From?.replace(/^whatsapp:/i, "").trim() ?? null;

      if (userId) {
        req.log.info({ userId, token: bodyText }, "WhatsApp onboarding token verified");
        if (phoneRaw) {
          void sendWhatsApp(
            phoneRaw,
            "✅ WhatsApp verificado! A Vesta está conectada. Me encaminhe qualquer mensagem da casa para começar.",
          );
        }
      } else {
        req.log.warn({ token: bodyText }, "WhatsApp token not found or expired");
        if (phoneRaw) {
          void sendWhatsApp(
            phoneRaw,
            "⚠️ Código não reconhecido ou expirado. Por favor, gere um novo código no app Vesta.",
          );
        }
      }
      return;
    }

    // Require at least some content for non-token messages
    if (!bodyText && !MediaUrl0) {
      req.log.info({ MessageSid }, "WhatsApp webhook: empty body and no media — skipping");
      return;
    }

    // Deduplicate: Twilio may retry on timeout
    if (MessageSid) {
      const [existing] = await db
        .select({ id: inboxItemsTable.id })
        .from(inboxItemsTable)
        .where(and(eq(inboxItemsTable.twilio_message_sid, MessageSid)))
        .limit(1);

      if (existing) {
        req.log.info({ MessageSid }, "Webhook: duplicate MessageSid — already ingested, skipping");
        return;
      }
    }

    // Strip the "whatsapp:" prefix from From number
    const phoneRaw = From?.replace(/^whatsapp:/i, "").trim() ?? null;

    if (!phoneRaw) {
      req.log.warn({ MessageSid }, "WhatsApp webhook: no sender phone — discarding");
      return;
    }

    // Normalise: strip all non-digit characters.
    // Exact normalised matching only — partial matching risks cross-tenant collision.
    const normalized = (p: string) => p.replace(/\D/g, "");
    const phoneNorm = normalized(phoneRaw);

    // ── Resolve household from sender phone ──────────────────────────────────
    let householdId: number | null = null;
    let resolvedSenderName: string | null = ProfileName ?? null;
    let resolvedSenderIsContact = false;
    let resolvedContactConsentStatus: string | null = null;

    const allContacts = await db
      .select({
        id: contactsTable.id,
        name: contactsTable.name,
        phone: contactsTable.phone,
        household_id: contactsTable.household_id,
        consent_status: contactsTable.consent_status,
      })
      .from(contactsTable);

    const matchedContacts = allContacts.filter(
      (c) => c.phone && normalized(c.phone) === phoneNorm,
    );

    const allMembers = await db
      .select({
        name: membersTable.name,
        phone: membersTable.phone,
        household_id: membersTable.household_id,
      })
      .from(membersTable);

    const matchedMembers = allMembers.filter(
      (m) => m.phone && normalized(m.phone) === phoneNorm,
    );

    const matchedHouseholdIds = new Set<number>([
      ...matchedContacts.map((c) => c.household_id),
      ...matchedMembers.map((m) => m.household_id),
    ]);

    if (matchedHouseholdIds.size === 0) {
      // Unknown sender — discard
    } else if (matchedHouseholdIds.size === 1) {
      householdId = [...matchedHouseholdIds][0];

      const contactMatch = matchedContacts.find((c) => c.household_id === householdId);
      if (contactMatch) {
        resolvedSenderName = contactMatch.name;
        resolvedSenderIsContact = true;
        resolvedContactConsentStatus = contactMatch.consent_status;
        req.log.info(
          { contact: contactMatch.name, householdId, consent_status: contactMatch.consent_status },
          "Webhook: matched sender to contact",
        );
      } else {
        const memberMatch = matchedMembers.find((m) => m.household_id === householdId);
        if (memberMatch) {
          resolvedSenderName = memberMatch.name;
          req.log.info({ member: memberMatch.name, householdId }, "Webhook: matched sender to member");
        }
      }
    } else {
      req.log.error(
        { phone: phoneRaw, matchedHouseholdIds: [...matchedHouseholdIds], MessageSid },
        "Webhook: phone number matched multiple households — discarding to prevent cross-tenant misdelivery",
      );
      return;
    }

    if (!householdId) {
      req.log.warn(
        { phone: phoneRaw, ProfileName },
        "Webhook: unknown sender — discarding to prevent cross-tenant pollution",
      );
      return;
    }

    // Determine source and content — process media if present
    const hasMedia = parseInt(NumMedia ?? "0", 10) > 0;

    let source: string = "whatsapp";
    let rawContent: string = bodyText;

    if (hasMedia && MediaUrl0 && MediaContentType0) {
      req.log.info(
        { contentType: MediaContentType0, MessageSid },
        "Webhook: processing media attachment",
      );
      const processed = await processWhatsAppMedia(MediaUrl0, MediaContentType0, bodyText || undefined);
      source = processed.source;
      rawContent = processed.rawContent;
    } else if (!rawContent) {
      rawContent = "(mídia recebida)";
    }

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

    // LGPD: only ACK when consent permits
    const ackAllowed = !resolvedSenderIsContact || resolvedContactConsentStatus === "granted";
    if (ackAllowed) {
      void sendWhatsApp(
        phoneRaw,
        "✓ Mensagem recebida! Vou analisar e avisar você em breve.",
      ).then((result) => {
        if (!result.ok) {
          req.log.warn({ error: result.error, phone: phoneRaw }, "ACK send failed");
        }
      });
    }

    // Run AI classifier asynchronously
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
    description:
      "Configure este URL no console do Twilio como webhook de entrada para seu número WhatsApp Business.",
    status: primaryDomain ? "configured" : "needs_domain",
    twilioConfigured: isTwilioConfigured(),
  });
});

export default router;
