import { pgTable, serial, integer, text, timestamp, jsonb, index, unique } from "drizzle-orm/pg-core";

/**
 * A single Q&A turn stored for multi-turn context resolution.
 * Only the original question text and the resolved intent type are kept —
 * the full WhatsApp reply text is never stored here.
 */
export type QATurnRecord = {
  /** Original question text (truncated to 200 chars) */
  q: string;
  /** Resolved QuestionType, e.g. "agenda_today" */
  type: string;
};

/**
 * Per-sender Q&A session store.
 *
 * Holds up to MAX_QA_TURNS (5) turns per sender+household combination with a
 * 15-minute inactivity TTL.  Rows are soft-deleted by the scheduler's
 * pruneExpiredQaSessions tick; they also expire naturally because every
 * lookup filters on expires_at > NOW().
 *
 * Security: `household_id` is always part of every read/write so sessions
 * are fully tenant-scoped — no cross-household context leakage is possible.
 */
export const waQaSessionsTable = pgTable(
  "wa_qa_sessions",
  {
    id: serial("id").primaryKey(),
    household_id: integer("household_id").notNull(),
    /** Normalised sender phone (digits only, no whatsapp: prefix) */
    sender_phone: text("sender_phone").notNull(),
    /** JSON array of the last MAX_QA_TURNS turns, oldest first */
    turns: jsonb("turns").$type<QATurnRecord[]>().notNull().default([]),
    last_active_at: timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(),
    /** Absolute TTL: last_active_at + 15 minutes */
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("wa_qa_sessions_sender_uniq").on(table.household_id, table.sender_phone),
    index("wa_qa_sessions_lookup_idx").on(
      table.household_id,
      table.sender_phone,
      table.expires_at,
    ),
  ],
);

export type WaQaSession = typeof waQaSessionsTable.$inferSelect;
