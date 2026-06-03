import { db } from "@workspace/db";
import { contactsTable, householdsTable } from "@workspace/db";
import { and, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { logger } from "./logger";
import { sendWhatsApp } from "./whatsapp";
import { replyConsentRequest } from "./wa-reply-composer";

const CONSENT_WINDOW_DAYS = 14;
const RATE_LIMIT_HOURS = 24;

/**
 * Daily scheduler job: sends WhatsApp consent renewal requests to contacts
 * whose consent check-in is due within the next 14 days.
 *
 * For each eligible contact (consent_status = "consented" and
 * consent_check_in_due_at <= now + 14 days):
 *   - Skips if last_consent_requested_at was within the last 24 hours
 *     (idempotency / rate limit guard).
 *   - Sends the LGPD consent request via WhatsApp.
 *   - Resets consent_status to "pending" and stamps last_consent_requested_at.
 *
 * The status reset happens regardless of WhatsApp delivery success so that
 * the contact must re-confirm before the household can message them again.
 * This mirrors the behaviour of the manual /contacts/:id/request-consent route.
 */
export async function runConsentRenewalJob(): Promise<void> {
  const now = new Date();
  const windowEnd = new Date(now);
  windowEnd.setDate(windowEnd.getDate() + CONSENT_WINDOW_DAYS);

  // Find all consented contacts whose check-in is due within 14 days
  // (or already overdue but still showing "consented" — they haven't been
  // nudged yet, or a previous send failed).
  const contacts = await db
    .select({
      id: contactsTable.id,
      household_id: contactsTable.household_id,
      name: contactsTable.name,
      phone: contactsTable.phone,
      last_consent_requested_at: contactsTable.last_consent_requested_at,
    })
    .from(contactsTable)
    .where(
      and(
        eq(contactsTable.consent_status, "consented"),
        isNotNull(contactsTable.consent_check_in_due_at),
        lte(contactsTable.consent_check_in_due_at, windowEnd),
        isNotNull(contactsTable.phone),
      ),
    );

  if (contacts.length === 0) {
    logger.debug("Consent renewal: no contacts due within 14 days");
    return;
  }

  logger.info({ count: contacts.length }, "Consent renewal: processing contacts");

  // Resolve household names for the consent message copy.
  const householdIds = [...new Set(contacts.map((c) => c.household_id))];
  const households = await db
    .select({ id: householdsTable.id, name: householdsTable.name })
    .from(householdsTable)
    .where(inArray(householdsTable.id, householdIds));

  const householdNameMap = new Map(households.map((h) => [h.id, h.name]));

  let sent = 0;
  let rateLimited = 0;

  for (const contact of contacts) {
    // Idempotency guard: skip if a request was already sent within 24 hours.
    if (contact.last_consent_requested_at) {
      const hoursSince =
        (now.getTime() - new Date(contact.last_consent_requested_at).getTime()) /
        (1000 * 60 * 60);
      if (hoursSince < RATE_LIMIT_HOURS) {
        logger.debug(
          { contactId: contact.id, hoursSince: Math.round(hoursSince) },
          "Consent renewal: skipping — rate limit",
        );
        rateLimited++;
        continue;
      }
    }

    const householdName = householdNameMap.get(contact.household_id) ?? null;
    const message = replyConsentRequest(householdName);
    const sendResult = await sendWhatsApp(contact.phone!, message);

    if (sendResult.ok) {
      logger.info(
        { contactId: contact.id, householdId: contact.household_id, sid: sendResult.sid },
        "Consent renewal: request sent",
      );
    } else {
      logger.warn(
        {
          contactId: contact.id,
          householdId: contact.household_id,
          error: sendResult.error,
        },
        "Consent renewal: WhatsApp send failed — resetting status to pending anyway",
      );
    }

    // Reset to pending and stamp the request time regardless of delivery
    // outcome — mirrors the manual /contacts/:id/request-consent route.
    // This ensures the contact must re-confirm before the household can
    // message them again, even if the send was not delivered.
    await db
      .update(contactsTable)
      .set({
        consent_status: "pending",
        last_consent_requested_at: now,
      })
      .where(eq(contactsTable.id, contact.id));

    sent++;
  }

  logger.info(
    { sent, rateLimited },
    "Consent renewal: job complete",
  );
}
