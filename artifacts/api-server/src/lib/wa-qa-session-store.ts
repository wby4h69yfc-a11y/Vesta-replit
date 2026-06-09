/**
 * wa-qa-session-store.ts
 *
 * Lightweight store for multi-turn Q&A context.  Each record holds up to
 * MAX_QA_TURNS question/type pairs for a given sender+household, with a
 * 15-minute inactivity TTL.
 *
 * Security: every operation is scoped to both `senderPhone` AND `householdId`
 * so sessions are fully tenant-isolated.  No cross-household reads are possible.
 */

import { db } from "@workspace/db";
import { waQaSessionsTable } from "@workspace/db";
import type { QATurnRecord } from "@workspace/db";
import { and, eq, lt, sql } from "drizzle-orm";

export type { QATurnRecord };

/** Maximum number of turns to keep per session. Oldest turn is dropped first. */
export const MAX_QA_TURNS = 5;

/** Session TTL in milliseconds. */
const QA_SESSION_TTL_MS = 15 * 60 * 1000;

function ttlExpiry(): Date {
  return new Date(Date.now() + QA_SESSION_TTL_MS);
}

/**
 * Returns the active turns for this sender+household, or an empty array when
 * no live session exists.  Expired sessions are treated as if they don't exist.
 */
export async function loadQaSession(
  senderPhone: string,
  householdId: number,
): Promise<QATurnRecord[]> {
  const [row] = await db
    .select({ turns: waQaSessionsTable.turns })
    .from(waQaSessionsTable)
    .where(
      and(
        eq(waQaSessionsTable.household_id, householdId),
        eq(waQaSessionsTable.sender_phone, senderPhone),
        sql`${waQaSessionsTable.expires_at} > NOW()`,
      ),
    )
    .limit(1);

  return row?.turns ?? [];
}

/**
 * Appends a new turn to the session, creating the session row if it does not
 * exist.  If the session already has MAX_QA_TURNS turns, the oldest is dropped
 * to stay within the cap.  The TTL is reset (slid forward) on every append.
 */
export async function appendQaTurn(
  senderPhone: string,
  householdId: number,
  turn: QATurnRecord,
): Promise<void> {
  const existing = await loadQaSession(senderPhone, householdId);

  const updatedTurns = [...existing, turn].slice(-MAX_QA_TURNS);
  const now = new Date();
  const expiresAt = ttlExpiry();

  await db
    .insert(waQaSessionsTable)
    .values({
      household_id: householdId,
      sender_phone: senderPhone,
      turns: updatedTurns,
      last_active_at: now,
      expires_at: expiresAt,
    })
    .onConflictDoUpdate({
      target: [waQaSessionsTable.household_id, waQaSessionsTable.sender_phone],
      set: {
        turns: updatedTurns,
        last_active_at: now,
        expires_at: expiresAt,
      },
    });
}

/**
 * Immediately clears the session for this sender+household.
 * Call this when the sender starts an unrelated flow (approval, mutation) so
 * stale Q&A context is never accidentally applied to a later question.
 */
export async function clearQaSession(
  senderPhone: string,
  householdId: number,
): Promise<void> {
  await db
    .delete(waQaSessionsTable)
    .where(
      and(
        eq(waQaSessionsTable.household_id, householdId),
        eq(waQaSessionsTable.sender_phone, senderPhone),
      ),
    );
}

/**
 * Deletes all rows whose TTL has elapsed.  Intended for the scheduler's daily
 * maintenance tick.  Returns the number of rows deleted.
 */
export async function pruneExpiredQaSessions(): Promise<number> {
  const deleted = await db
    .delete(waQaSessionsTable)
    .where(lt(waQaSessionsTable.expires_at, new Date()))
    .returning({ id: waQaSessionsTable.id });

  return deleted.length;
}
