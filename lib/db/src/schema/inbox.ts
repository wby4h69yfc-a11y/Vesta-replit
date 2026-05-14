import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const inboxItemsTable = pgTable("inbox_items", {
  id: serial("id").primaryKey(),
  household_id: integer("household_id").notNull().default(1),
  source: text("source").notNull().default("manual"),
  raw_content: text("raw_content").notNull(),
  media_url: text("media_url"),
  status: text("status").notNull().default("received"),
  sender_name: text("sender_name"),
  twilio_message_sid: text("twilio_message_sid"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertInboxItemSchema = createInsertSchema(inboxItemsTable).omit({ id: true, created_at: true, updated_at: true });
export type InsertInboxItem = z.infer<typeof insertInboxItemSchema>;
export type InboxItem = typeof inboxItemsTable.$inferSelect;
