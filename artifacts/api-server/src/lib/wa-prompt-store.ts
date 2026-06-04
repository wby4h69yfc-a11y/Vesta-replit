/**
 * WA Conversation Prompt Store — DB-backed
 *
 * Binds a WhatsApp sender phone to the specific suggested action ID they
 * were shown in a proposal message. Persisted in the `wa_conversations`
 * table so all server instances share state (required for autoscale).
 *
 * Replaces the previous in-memory Map implementation. Interface is now async.
 *
 * Flow:
 *   1. Classifier produces a suggested action → recordPrompt(phone, actionId, householdId, payload)
 *   2. replyActionProposal is sent to the sender
 *   3. Sender replies → getPromptedActionId(phone, householdId) returns the exact
 *      action ID they were shown (not the most-recent pending action for the household)
 *   4. After approval/dismissal → clearPrompt(phone)
 *
 * TTL: 24 hours.
 */

import { db } from "@workspace/db";
import { waConversationsTable } from "@workspace/db";
import { and, eq, gt, desc, lt } from "drizzle-orm";

const TTL_MS = 24 * 60 * 60 * 1000;

export function normalisePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

/**
 * Record that `phone` was just shown a proposal for `actionId` in `householdId`.
 * Dismisses any previous open conversation for that sender first.
 */
export async function recordPrompt(
  phone: string,
  actionId: number,
  householdId: number,
  proposedPayload?: { title: string; type: string | null; category: string | null; datetime: string | null },
): Promise<void> {
  const phoneNorm = normalisePhone(phone);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TTL_MS);

  // Dismiss any existing awaiting_confirmation rows for this sender so
  // the lookup always returns only the freshest proposal.
  await db
    .update(waConversationsTable)
    .set({ state: "dismissed" })
    .where(
      and(
        eq(waConversationsTable.household_id, householdId),
        eq(waConversationsTable.sender_phone, phoneNorm),
        eq(waConversationsTable.state, "awaiting_confirmation"),
      ),
    );

  await db.insert(waConversationsTable).values({
    household_id: householdId,
    sender_phone: phoneNorm,
    state: "awaiting_confirmation",
    pending_action_id: actionId,
    proposed_payload: proposedPayload ?? null,
    thread_context: "approval",
    last_message_at: now,
    expires_at: expiresAt,
  });
}

/**
 * Return the action ID that was most recently proposed to `phone` in `householdId`,
 * or null if no valid binding exists or the conversation has expired.
 */
export async function getPromptedActionId(
  phone: string,
  householdId: number,
): Promise<number | null> {
  const phoneNorm = normalisePhone(phone);
  const now = new Date();

  const [row] = await db
    .select({ pending_action_id: waConversationsTable.pending_action_id })
    .from(waConversationsTable)
    .where(
      and(
        eq(waConversationsTable.household_id, householdId),
        eq(waConversationsTable.sender_phone, phoneNorm),
        eq(waConversationsTable.state, "awaiting_confirmation"),
        gt(waConversationsTable.expires_at, now),
      ),
    )
    .orderBy(desc(waConversationsTable.created_at))
    .limit(1);

  return row?.pending_action_id ?? null;
}

/**
 * Mark the conversation for `phone` as completed after the approval is processed.
 *
 * Sets last_message_at = now so the 5-minute undo window is measured from the
 * moment of approval, not from when the conversation was created.
 */
export async function clearPrompt(phone: string): Promise<void> {
  const phoneNorm = normalisePhone(phone);
  const now = new Date();
  await db
    .update(waConversationsTable)
    .set({ state: "completed", last_message_at: now })
    .where(
      and(
        eq(waConversationsTable.sender_phone, phoneNorm),
        eq(waConversationsTable.state, "awaiting_confirmation"),
      ),
    );
}

/**
 * Expire all wa_conversations rows past their expires_at, and purge stale
 * completed/dismissed rows older than 24 h.
 * Called by the scheduler every 15 minutes.
 */
export async function expireOldConversations(): Promise<number> {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // 1. Dismiss awaiting_confirmation rows past their hard expiry.
  const expireResult = await db
    .update(waConversationsTable)
    .set({ state: "dismissed" })
    .where(
      and(
        eq(waConversationsTable.state, "awaiting_confirmation"),
        lt(waConversationsTable.expires_at, now),
      ),
    );

  // 2. Purge old completed/dismissed rows to bound table growth.
  //    Rows younger than 24 h are kept so the 5-min undo window can always
  //    look back at the most recently completed conversation.
  await db
    .delete(waConversationsTable)
    .where(lt(waConversationsTable.created_at, oneDayAgo));

  return (expireResult as unknown as { rowCount?: number }).rowCount ?? 0;
}
