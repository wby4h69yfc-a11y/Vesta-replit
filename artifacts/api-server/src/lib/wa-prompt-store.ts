/**
 * In-memory store that binds a WhatsApp sender phone to the specific
 * suggested action ID they were shown in a proposal message.
 *
 * This prevents the "approval hijack" race condition where a recognized sender
 * races in a new message so an admin's "sim" reply approves the wrong (newly
 * created) action instead of the one the admin actually reviewed.
 *
 * Flow:
 *   1. Classifier produces a suggested action → recordPrompt(phone, actionId, householdId)
 *   2. replyActionProposal is sent to the sender
 *   3. Sender replies "sim"/"não"/etc. → getPromptedActionId(phone, householdId) returns
 *      the exact action ID they were shown; the handler queries by ID rather than
 *      picking the most-recently-created pending action for the household.
 *   4. After the approval/dismissal is processed → clearPrompt(phone)
 *
 * TTL: 24 hours — long enough for delayed replies while still bounding the window.
 */

const TTL_MS = 24 * 60 * 60 * 1000;

interface PromptEntry {
  actionId: number;
  householdId: number;
  expiresAt: number;
}

const store = new Map<string, PromptEntry>();

function normaliseKey(phone: string): string {
  return phone.replace(/\D/g, "");
}

/**
 * Record that `phone` was just shown a proposal for `actionId` in `householdId`.
 * Replaces any existing binding for that phone.
 */
export function recordPrompt(phone: string, actionId: number, householdId: number): void {
  const key = normaliseKey(phone);
  for (const [k, v] of store.entries()) {
    if (Date.now() > v.expiresAt) store.delete(k);
  }
  store.set(key, { actionId, householdId, expiresAt: Date.now() + TTL_MS });
}

/**
 * Return the action ID that was most recently proposed to `phone` in `householdId`,
 * or null if no valid binding exists.
 *
 * The householdId cross-check prevents a phone that somehow appears in two households
 * from using a stale binding belonging to the other household.
 */
export function getPromptedActionId(phone: string, householdId: number): number | null {
  const key = normaliseKey(phone);
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  if (entry.householdId !== householdId) return null;
  return entry.actionId;
}

/** Remove the binding for `phone` after the approval/dismissal is processed. */
export function clearPrompt(phone: string): void {
  store.delete(normaliseKey(phone));
}
