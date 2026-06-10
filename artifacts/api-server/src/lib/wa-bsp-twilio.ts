import type { Request } from "express";
import type { WaBspAdapter, InboundWAMessage, SendResult, InteractivePayload } from "./wa-bsp";
import { InteractiveNotSupportedError } from "./wa-bsp";
import { logger } from "./logger";

const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;

/**
 * Validates a Twilio HMAC signature for an inbound webhook request against
 * a caller-supplied URL path (e.g. "/api/webhook/whatsapp" or
 * "/api/webhook/whatsapp/status").
 *
 * Exported so the status-callback route (a Twilio-specific surface) can
 * reuse the same verification logic with its own path without duplicating code.
 *
 * Always returns true outside of production so dev/test environments work
 * without real Twilio credentials.
 */
export async function validateTwilioRequest(req: Request, urlPath: string): Promise<boolean> {
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (process.env.NODE_ENV !== "production") {
    req.log.warn(`NODE_ENV !== production — skipping Twilio signature check for ${urlPath} (development mode)`);
    return true;
  }

  if (!authToken) {
    req.log.error("TWILIO_AUTH_TOKEN not set in production — rejecting webhook request");
    return false;
  }

  const signature = (req.headers["x-twilio-signature"] ?? "") as string;
  if (!signature) {
    req.log.warn("Webhook: missing X-Twilio-Signature header");
    return false;
  }

  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ?? "https";
  const host =
    (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim() ??
    (req.headers["host"] as string | undefined) ??
    process.env.REPLIT_DEV_DOMAIN ??
    process.env.REPLIT_DOMAINS?.split(",")[0] ??
    "localhost";
  const webhookUrl = `${proto}://${host}${urlPath}`;

  const { validateRequest } = await import("twilio");
  const params = (req.body ?? {}) as Record<string, string>;
  return validateRequest(authToken, signature, webhookUrl, params);
}

export class WaBspTwilioAdapter implements WaBspAdapter {
  isConfigured(): boolean {
    return !!(
      process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_WHATSAPP_FROM
    );
  }

  async send(to: string, body: string): Promise<SendResult> {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_WHATSAPP_FROM;

    if (!accountSid || !authToken || !from) {
      logger.warn({ to }, "WaBspTwilio.send: not configured — skipping");
      return { ok: false, error: "Twilio not configured" };
    }

    const toAddr = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
    const fromAddr = from.startsWith("whatsapp:") ? from : `whatsapp:${from}`;

    try {
      const twilio = await import("twilio");
      const client = twilio.default(accountSid, authToken);
      const statusCbDomain =
        process.env.REPLIT_DOMAINS?.split(",")[0]?.trim() ??
        process.env.REPLIT_DEV_DOMAIN ??
        null;
      const statusCallback = statusCbDomain
        ? `https://${statusCbDomain}/api/webhook/whatsapp/status`
        : undefined;

      const msg = await client.messages.create({
        from: fromAddr,
        to: toAddr,
        body,
        ...(statusCallback ? { statusCallback } : {}),
      });
      logger.info({ to, sid: msg.sid }, "WhatsApp sent via Twilio");
      return { ok: true, sid: msg.sid };
    } catch (err) {
      logger.error({ err, to }, "WhatsApp Twilio send failed");
      return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
    }
  }

  /**
   * Sends a WhatsApp interactive button message via the Twilio Messages API.
   *
   * Twilio delivers WhatsApp interactive messages by including a JSON-encoded
   * `Interactive` parameter alongside the standard To/From fields. This works
   * for WhatsApp Business accounts within a 24-hour session window.
   *
   * Sandbox numbers (Twilio trial / sandbox) do not support interactive
   * messages — Twilio returns a 21xxx error code. We convert that to
   * InteractiveNotSupportedError so callers can fall back to plain text.
   */
  async sendInteractive(to: string, payload: InteractivePayload): Promise<SendResult> {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_WHATSAPP_FROM;

    if (!accountSid || !authToken || !from) {
      logger.warn({ to }, "WaBspTwilio.sendInteractive: not configured — skipping");
      return { ok: false, error: "Twilio not configured" };
    }

    const toAddr = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
    const fromAddr = from.startsWith("whatsapp:") ? from : `whatsapp:${from}`;

    // Build the WhatsApp interactive payload in the format Twilio expects.
    // Twilio maps this to the WhatsApp Cloud API interactive object.
    const interactive = {
      type: "button",
      body: { text: payload.body },
      ...(payload.footer ? { footer: { text: payload.footer } } : {}),
      action: {
        buttons: payload.buttons.map((btn) => ({
          type: "reply",
          reply: {
            id: btn.id,
            title: btn.title.substring(0, 20), // WhatsApp enforces 20-char limit
          },
        })),
      },
    };

    try {
      // Use the Twilio REST API directly so we can pass the Interactive param,
      // which the twilio SDK's typed create() does not expose on the base interface.
      const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
      const body = new URLSearchParams({
        From: fromAddr,
        To: toAddr,
        Body: payload.body,
        Interactive: JSON.stringify(interactive),
      });

      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { code?: number; message?: string };
        const code = data.code ?? 0;
        const message = data.message ?? `HTTP ${res.status}`;

        // Twilio 21xxx codes indicate the feature is unavailable for this number/tier.
        // 21608 = sandbox-only restriction; 21xxx range broadly covers capability issues.
        if (code >= 21000 && code < 22000) {
          throw new InteractiveNotSupportedError(
            `Twilio ${code}: ${message} — falling back to plain text`,
          );
        }

        throw new Error(`Twilio sendInteractive failed: ${code} ${message}`);
      }

      const data = await res.json() as { sid?: string };
      const sid = data.sid ?? "twilio-interactive-unknown";
      logger.info({ to, sid }, "WhatsApp interactive sent via Twilio");
      return { ok: true, sid };
    } catch (err) {
      if (err instanceof InteractiveNotSupportedError) throw err;
      logger.error({ err, to }, "WhatsApp Twilio sendInteractive failed");
      return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
    }
  }

  async validateWebhookRequest(req: Request): Promise<boolean> {
    return validateTwilioRequest(req, "/api/webhook/whatsapp");
  }

  parseInboundPayload(body: unknown): InboundWAMessage | null {
    const b = body as Record<string, string | undefined>;
    const from = b.From ?? "";
    if (!from) return null;

    // Group detection: Twilio sets To to the group JID (contains @g.us) for group messages.
    const rawTo = b.To ?? "";
    const groupSourced = rawTo.includes("@g.us");

    // Interactive button-tap detection.
    // When a user taps a quick-reply button, Twilio delivers:
    //   ButtonPayload = the button's reply ID (e.g. "approve")
    //   ButtonText    = the button's display label
    //   Body          = the button's display label (same as ButtonText)
    // We normalise button taps to their reply ID so the existing Sim/Não
    // handler receives the machine-readable token, not the display label.
    const buttonPayload = b.ButtonPayload;

    // Twilio embeds quoted/replied-to message lines with a leading "> " prefix.
    // Strip those lines so the classifier only sees the sender's new content
    // and never accidentally triggers approval logic from quoted "Sim"/"Não".
    const rawBody = b.Body ?? "";
    const strippedBody = rawBody
      .split("\n")
      .filter((line) => !line.startsWith("> "))
      .join("\n")
      .trim();

    const effectiveBody = buttonPayload ? buttonPayload.trim() : strippedBody;

    return {
      from,
      body: effectiveBody,
      profileName: b.ProfileName ?? null,
      mediaUrl: b.MediaUrl0 ?? null,
      mediaContentType: b.MediaContentType0 ?? null,
      numMedia: b.NumMedia ?? "0",
      messageSid: b.MessageSid ?? null,
      groupId: groupSourced ? rawTo : null,
    };
  }

  async downloadMedia(
    mediaRef: string,
    _mimeType: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    const headers: Record<string, string> = {};
    if (accountSid && authToken) {
      const creds = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
      headers["Authorization"] = `Basic ${creds}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

    try {
      const res = await fetch(mediaRef, { headers, signal: controller.signal });
      if (!res.ok) {
        throw new Error(
          `Twilio media download failed: ${res.status} ${res.statusText}`,
        );
      }

      const contentLengthHeader = res.headers.get("content-length");
      if (contentLengthHeader !== null) {
        const declared = parseInt(contentLengthHeader, 10);
        if (!isNaN(declared) && declared > MAX_MEDIA_BYTES) {
          throw new Error(
            `Twilio media rejected: Content-Length ${declared} bytes exceeds ${MAX_MEDIA_BYTES} bytes`,
          );
        }
      }

      const contentType = res.headers.get("content-type") ?? "application/octet-stream";
      const arrayBuffer = await res.arrayBuffer();

      if (arrayBuffer.byteLength > MAX_MEDIA_BYTES) {
        throw new Error(
          `Twilio media rejected: actual size ${arrayBuffer.byteLength} bytes exceeds ${MAX_MEDIA_BYTES} bytes`,
        );
      }

      return { buffer: Buffer.from(arrayBuffer), contentType };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
