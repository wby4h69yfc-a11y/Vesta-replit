import { pgTable, text, serial, timestamp, integer, real, boolean, uniqueIndex, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const suggestedActionsTable = pgTable(
  "suggested_actions",
  {
    id: serial("id").primaryKey(),
    inbox_item_id: integer("inbox_item_id").notNull(),
    household_id: integer("household_id").notNull(),
    category: text("category").notNull().default("outros"),
    type: text("type").notNull().default("task"),
    title: text("title").notNull(),
    datetime: text("datetime"),
    suggested_owner: text("suggested_owner"),
    approval_level: text("approval_level").notNull().default("one_tap"),
    confidence: real("confidence").notNull().default(0.7),
    status: text("status").notNull().default("pending"),
    notes: text("notes"),
    cascade_check_needed: boolean("cascade_check_needed").notNull().default(false),
    workflow_tags: text("workflow_tags").array().notNull().default([]),
    payment_data: jsonb("payment_data").$type<{
      amount_cents?: number | null;
      recipient?: string | null;
      due_date?: string | null;
      payment_method?: string | null;
    } | null>(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("suggested_actions_inbox_item_id_unique").on(table.inbox_item_id),
  ],
);

export const insertSuggestedActionSchema = createInsertSchema(suggestedActionsTable).omit({ id: true, created_at: true, updated_at: true });
export type InsertSuggestedAction = z.infer<typeof insertSuggestedActionSchema>;
export type SuggestedAction = typeof suggestedActionsTable.$inferSelect;
