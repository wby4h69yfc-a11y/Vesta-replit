import type { Request } from "express";

/**
 * Normalised inbound WhatsApp message payload.
 * Both the Twilio and 360Dialog adapters produce this shape.
 * wa-message-processor.ts accepts this as InboundWAMessage (structurally compatible).
 */
export interface InboundWAMessage {
  /** Raw From field, e.g. "whatsapp:+5511999990000" */
  from: string;
  /** Message text, already trimmed. Empty string for media-only messages. */
  body: string;
  /** Display name from the sender's WA profile */
  profileName?: string | null;
  /**
   * Media reference for attachments.
   * Twilio: a full URL (fetched with Basic Auth via AccountSID:AuthToken).
   * 360Dialog: a media ID (fetched from their /v1/media/{id} endpoint).
   * The active adapter's downloadMedia() method handles either form.
   */
  mediaUrl?: string | null;
  mediaContentType?: string | null;
  /** Number of media attachments as a string (e.g. "0" or "1"). */
  numMedia?: string | null;
  /**
   * Message ID used for deduplication.
   * Twilio: MessageSid. 360Dialog: Cloud API message id (wamid.*).
   */
  messageSid?: string | null;
  /**
   * Group JID when the message came from a WhatsApp group chat.
   * Null/undefined for direct messages.
   * When set, the webhook handler strips the /vesta prefix from body
   * before passing to processInboundWAMessage.
   */
  groupId?: string | null;
}

export type SendResult =
  | { ok: true; sid: string }
  | { ok: false; error: string };

/**
 * BSP adapter interface — implement once per WhatsApp Business Solution Provider.
 */
export interface WaBspAdapter {
  /** True when all required credentials for this BSP are present in env. */
  isConfigured(): boolean;
  /** Sends a WhatsApp text message. Never throws — always returns a result object. */
  send(to: string, body: string): Promise<SendResult>;
  /**
   * Validates the inbound webhook request's authenticity.
   * @param req      Express request (parsed body available for Twilio form posts).
   * @param rawBody  Raw request body Buffer (required for 360Dialog HMAC validation).
   */
  validateWebhookRequest(req: Request, rawBody?: Buffer): Promise<boolean>;
  /**
   * Parses the BSP-specific inbound payload into the normalised InboundWAMessage shape.
   * Returns null when the payload contains no processable inbound message.
   */
  parseInboundPayload(body: unknown): InboundWAMessage | null;
  /**
   * Downloads a media attachment from the BSP.
   * Twilio: mediaRef is a direct authenticated URL.
   * 360Dialog: mediaRef is a media ID fetched from their /v1/media/{id} endpoint.
   */
  downloadMedia(mediaRef: string, mimeType: string): Promise<{ buffer: Buffer; contentType: string }>;
}

let _adapter: WaBspAdapter | null = null;

/**
 * Returns the singleton BSP adapter selected by the WA_BSP env var.
 * Defaults to "twilio" for backward compatibility.
 * Valid values: "twilio" | "360dialog"
 *
 * Uses require() lazily to avoid a runtime circular dependency:
 * the adapter files import types from this file, and this factory
 * instantiates the adapter classes — using static imports in both
 * directions would create a module-load cycle.
 */
export function getBspAdapter(): WaBspAdapter {
  if (_adapter) return _adapter;
  const bsp = (process.env.WA_BSP ?? "twilio").toLowerCase();
  if (bsp === "360dialog") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { WaBsp360DialogAdapter } = require("./wa-bsp-360dialog") as typeof import("./wa-bsp-360dialog");
    _adapter = new WaBsp360DialogAdapter();
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { WaBspTwilioAdapter } = require("./wa-bsp-twilio") as typeof import("./wa-bsp-twilio");
    _adapter = new WaBspTwilioAdapter();
  }
  return _adapter!;
}
