import { logger } from "./logger";
import { db } from "@workspace/db";
import { onboardingStateTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getBspAdapter, type SendResult } from "./wa-bsp";

export type { SendResult } from "./wa-bsp";

/**
 * Dev/test telemetry: every sendWhatsApp call is recorded here when
 * NODE_ENV !== "production".  The buffer is drained via drainWaSendLog()
 * which is exposed through the GET /api/dev/wa-sends endpoint.
 *
 * Never populated in production — the guard is inlined at the call site.
 * Works regardless of which BSP adapter is active.
 */
const _waSendLog: Array<{ to: string; body: string; at: string }> = [];

/**
 * Returns all buffered sendWhatsApp calls since the last drain and resets
 * the buffer.  Dev/test only — not callable from production paths.
 */
export function drainWaSendLog(): Array<{ to: string; body: string; at: string }> {
  return _waSendLog.splice(0);
}

/**
 * Returns true only when the contact has active, unexpired LGPD consent.
 *
 * A contact's consent is active when BOTH conditions hold:
 *   1. consent_status === 'consented'  — explicit agreement was received, AND
 *   2. consent_check_in_due_at is null (no expiry configured) OR the expiry
 *      date is strictly in the future (the annual check-in has not yet lapsed).
 *
 * Important: contacts whose check-in date has already passed retain
 * consent_status = 'consented' in the database until the daily renewal
 * scheduler resets them to 'pending'.  Do NOT rely on consent_status alone —
 * always call this function before sending any outbound message to a contact.
 */
export function isConsentActive(contact: {
  consent_status: string | null;
  consent_check_in_due_at: Date | null;
}): boolean {
  if (contact.consent_status !== "consented") return false;
  if (contact.consent_check_in_due_at === null) return true;
  return contact.consent_check_in_due_at > new Date();
}

/**
 * Returns true only when all three Twilio credentials are present.
 * Kept for backward compatibility with the /webhook/whatsapp/info endpoint.
 * For BSP-agnostic configuration checks, use getBspAdapter().isConfigured().
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
 * Sends a WhatsApp message via the active BSP adapter (Twilio or 360Dialog).
 * Returns a result object — never throws.
 *
 * The active BSP is determined by the WA_BSP env var (default: "twilio").
 * Dev/test telemetry is recorded in _waSendLog regardless of which BSP is
 * active so existing E2E tests continue to work with either adapter.
 */
export async function sendWhatsApp(to: string, message: string): Promise<SendResult> {
  const adapter = getBspAdapter();

  // Normalise address for telemetry: add whatsapp: prefix if absent.
  // For 360Dialog the adapter strips it again before sending, but the log
  // captures the address in the same canonical form as the Twilio path.
  const toAddr = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;

  // Dev/test telemetry: record every attempted send so E2E tests can verify
  // the destination and body without needing live BSP credentials.
  if (process.env.NODE_ENV !== "production") {
    _waSendLog.push({ to: toAddr, body: message, at: new Date().toISOString() });
  }

  return adapter.send(to, message);
}
