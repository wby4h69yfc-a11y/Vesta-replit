import { pgTable, text, serial, timestamp, integer, real, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── Action Cascades ────────────────────────────────────────────────────────────
// One inbox message → multiple related suggested actions grouped under a cascade
export const actionCascadesTable = pgTable("action_cascades", {
  id: serial("id").primaryKey(),
  household_id: integer("household_id").notNull(),
  source_inbox_id: integer("source_inbox_id").notNull(),
  trigger_description: text("trigger_description").notNull(),
  /**
   * Differentiates cascade rendering in the inbox UI.
   * standard           — regular multi-intent cascade (Task #115)
   * parent_group_triage — WF-22: shows acao_necessaria / fyi / ignorar sections
   * backup_care         — WF-24: shows 5-step backup care cascade
   * matricula           — WF-21: shows document checklist cascade
   */
  cascade_type: text("cascade_type").notNull().default("standard"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const suggestedActionsTable = pgTable("suggested_actions", {
  id: serial("id").primaryKey(),
  inbox_item_id: integer("inbox_item_id").notNull(),
  household_id: integer("household_id").notNull(),
  cascade_id: integer("cascade_id").references(() => actionCascadesTable.id, { onDelete: "set null" }),
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
});

export const insertSuggestedActionSchema = createInsertSchema(suggestedActionsTable).omit({ id: true, created_at: true, updated_at: true });
export type InsertSuggestedAction = z.infer<typeof insertSuggestedActionSchema>;
export type SuggestedAction = typeof suggestedActionsTable.$inferSelect;
export type ActionCascade = typeof actionCascadesTable.$inferSelect;
