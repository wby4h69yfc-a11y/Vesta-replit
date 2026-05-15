import { logger } from "./logger";

export type SendResult =
  | { ok: true; sid: string }
  | { ok: false; error: string };

export function isTwilioConfigured(): boolean {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
}

export async function sendWhatsApp(to: string, message: string): Promise<SendResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM ?? "whatsapp:+14155238886";

  if (!accountSid || !authToken) {
    logger.warn({ to }, "sendWhatsApp: Twilio not configured — skipping");
    return { ok: false, error: "Twilio not configured" };
  }

  const toAddr = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
  const fromAddr = from.startsWith("whatsapp:") ? from : `whatsapp:${from}`;

  try {
    const twilio = await import("twilio");
    const client = twilio.default(accountSid, authToken);
    const msg = await client.messages.create({
      from: fromAddr,
      to: toAddr,
      body: message,
    });
    logger.info({ to, sid: msg.sid }, "WhatsApp sent");
    return { ok: true, sid: msg.sid };
  } catch (err) {
    logger.error({ err, to }, "WhatsApp send failed");
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
