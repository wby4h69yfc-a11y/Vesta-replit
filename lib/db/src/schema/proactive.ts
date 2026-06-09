import { pgTable, text, serial, timestamp, integer, jsonb, boolean, index } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export type ProactiveTriggerType =
  | "daily_digest"
  | "conflict_detected"
  | "payment_due"
  | "weekly_lookahead"
  | "inbox_nudge";

export type ProactiveStatus =
  | "queued"
  | "sent"
  | "failed"
  | "cancelled"
  | "suppressed";

export const proactiveMessageQueueTable = pgTable(
  "proactive_message_queue",
  {
    id: serial("id").primaryKey(),
    household_id: integer("household_id").notNull(),
    /** Optional: the admin user_id to notify (for future multi-admin routing) */
    user_id: text("user_id"),
    /** What triggered this message — one of: daily_digest, conflict_detected, payment_due, weekly_lookahead */
    trigger_type: text("trigger_type").notNull(),
    /**
     * Source artifact ID — for conflict_detected this is the first event's id,
     * for payment_due this is the task id.
     */
    trigger_source_id: integer("trigger_source_id"),
    template_name: text("template_name"),
    /** Rendered message body and any structured data needed for rendering */
    payload: jsonb("payload").$type<{
      message?: string;
      event_titles?: string[];
      task_titles?: string[];
      conflict_pair?: [string, string];
    }>(),
    scheduled_at: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    sent_at: timestamp("sent_at", { withTimezone: true }),
    /** One of: queued, sent, failed, cancelled, suppressed */
    status: text("status").notNull().default("queued"),
    /** Number of delivery attempts made */
    retry_count: integer("retry_count").notNull().default(0),
    /** True if the user replied to this proactive message */
    user_replied: boolean("user_replied").notNull().default(false),
    /** True if the user took an action (approved/dismissed an inline proposal) */
    user_acted: boolean("user_acted").notNull().default(false),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("proactive_queue_household_scheduled_status_idx").on(
      table.household_id,
      table.scheduled_at,
      table.status,
    ),
  ],
);

export type ProactiveMessageQueue = typeof proactiveMessageQueueTable.$inferSelect;

