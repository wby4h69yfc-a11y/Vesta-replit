import { logger } from "./logger";
import { db } from "@workspace/db";
import { membersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

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
 * Resolves the primary admin phone for a household.
 * Queries membersTable WHERE household_id = $1 AND role = 'admin'.
 * Returns null (no send) if no admin member with a phone is found.
 */
export async function resolveHouseholdAdminPhone(
  householdId: number,
): Promise<string | null> {
  const adminMembers = await db
    .select()
    .from(membersTable)
    .where(
      and(
        eq(membersTable.household_id, householdId),
        eq(membersTable.role, "admin"),
      ),
    )
    .limit(5);

  const phone = adminMembers.find((m) => m.phone)?.phone ?? null;

  if (!phone) {
    logger.warn(
      { householdId },
      "resolveHouseholdAdminPhone: no admin member with phone found — skipping notify",
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
