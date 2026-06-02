import { logger } from "./logger";
import { db } from "@workspace/db";
import { onboardingStateTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type SendResult =
  | { ok: true; sid: string }
  | { ok: false; error: string };

/**
 * Returns true only when all three Twilio credentials are present.
 * sendWhatsApp() uses the same check — no silent fallbacks exist.
 */
export function isTwilioConfigured(): boolean {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_WHATSAPP_FROM
  );
}

/**
 * Resolves the verified WhatsApp destination for a household.
 *
 * Returns ONLY the exact phone number that completed the token verification
 * flow for this household — stored as `whatsapp_verified_phone` on the
 * `onboarding_state` row at the time the webhook confirmed the token.
 *
 * This binding prevents delivery to a different stored admin phone that
 * was never proven to belong to this household: the verified phone and the
 * delivery destination are always the same value from the same DB row.
 *
 * Returning null (instead of falling back to any other phone) ensures that
 * every outbound send path — briefing, classifier notifications, and webhook
 * replies — cannot deliver household data to an unproven destination.
 */
export async function resolveHouseholdAdminPhone(
  householdId: number,
): Promise<string | null> {
  const [state] = await db
    .select({
      whatsapp_verified: onboardingStateTable.whatsapp_verified,
      whatsapp_verified_phone: onboardingStateTable.whatsapp_verified_phone,
    })
    .from(onboardingStateTable)
    .where(eq(onboardingStateTable.household_id, householdId))
    .limit(1);

  const phone = state?.whatsapp_verified
    ? (state.whatsapp_verified_phone ?? null)
    : null;

  if (!phone) {
    logger.warn(
      { householdId, verified: state?.whatsapp_verified ?? false },
      "resolveHouseholdAdminPhone: no verified phone on record — skipping notify",
    );
  }

  return phone;
}

/**
 * Sends a WhatsApp message via Twilio.
 * Returns a result object — never throws.
 * All three Twilio env vars must be set; there are no silent fallbacks.
 */
export async function sendWhatsApp(to: string, message: string): Promise<SendResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;

  if (!accountSid || !authToken || !from) {
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
