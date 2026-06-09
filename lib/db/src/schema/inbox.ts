import { pgTable, text, serial, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";

export const inboxItemsTable = pgTable(
  "inbox_items",
  {
    id: serial("id").primaryKey(),
    household_id: integer("household_id").notNull(),
    source: text("source").notNull().default("manual"),
    raw_content: text("raw_content").notNull(),
    media_url: text("media_url"),
    status: text("status").notNull().default("received"),
    sender_name: text("sender_name"),
    twilio_message_sid: text("twilio_message_sid"),
    gmail_message_id: text("gmail_message_id"),
    group_id: text("group_id"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    // Partial unique index: enforces one row per Twilio MessageSid while
    // allowing NULL (non-Twilio messages) without conflict.
    uniqueIndex("inbox_items_twilio_message_sid_unique")
      .on(table.twilio_message_sid)
      .where(sql`${table.twilio_message_sid} IS NOT NULL`),
    // Composite partial unique index: prevents the same Gmail message being
    // imported twice within the same household. Tenant-scoped so a message ID
    // collision across different users' mailboxes cannot cause false conflicts.
    uniqueIndex("inbox_items_household_gmail_message_id_unique")
      .on(table.household_id, table.gmail_message_id)
      .where(sql`${table.gmail_message_id} IS NOT NULL`),
  ],
);

export const insertInboxItemSchema = createInsertSchema(inboxItemsTable).omit({ id: true, created_at: true, updated_at: true });
export type InsertInboxItem = z.infer<typeof insertInboxItemSchema>;
export type InboxItem = typeof inboxItemsTable.$inferSelect;
