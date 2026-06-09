/**
 * Pure helpers for WhatsApp group message detection and /vesta trigger parsing.
 *
 * Extracted so both webhook.ts and unit tests can share the same logic without
 * any DB or IO dependencies.
 */

/**
 * Returns true when the Twilio `To` field identifies a WhatsApp group.
 *
 * For group messages Twilio sets `To` to the group JID, which always contains
 * the "@g.us" suffix (e.g. "whatsapp:+120363XXXXXXXX@g.us").  For 1:1 DMs
 * `To` is the Twilio number ("whatsapp:+14155238886"), which never has that
 * suffix.
 */
export function isGroupMessage(to: string): boolean {
  return to.includes("@g.us");
}

/**
 * Checks whether a message body starts with the `/vesta` trigger (case-insensitive).
 *
 * Returns the remainder of the body (everything after `/vesta` and any
 * following whitespace) when the trigger is present, or `null` when not.
 *
 * Examples:
 *   extractVestaTrigger("/vesta reunião quinta 19h")  → "reunião quinta 19h"
 *   extractVestaTrigger("/Vesta pausar")              → "pausar"
 *   extractVestaTrigger("/vesta")                     → ""  (empty command)
 *   extractVestaTrigger("oi, tudo bem?")              → null
 */
export function extractVestaTrigger(body: string): string | null {
  if (!/^\/vesta\b/i.test(body)) return null;
  return body.replace(/^\/vesta\s*/i, "").trim();
}
