import { pgTable, text, serial, timestamp, integer, real, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const rulesTable = pgTable("rules", {
  id: serial("id").primaryKey(),
  household_id: integer("household_id").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull().default("outros"),
  trigger_desc: text("trigger_desc").notNull(),
  action_desc: text("action_desc").notNull(),
  approval_level: text("approval_level").notNull().default("one_tap"),
  confidence: real("confidence").notNull().default(0.55),
  active: boolean("active").notNull().default(true),
  origin: text("origin").notNull().default("system_template"),
  times_triggered: integer("times_triggered").notNull().default(0),
  times_approved: integer("times_approved").notNull().default(0),
  times_dismissed: integer("times_dismissed").notNull().default(0),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertRuleSchema = createInsertSchema(rulesTable).omit({ id: true, created_at: true, updated_at: true });
export type InsertRule = z.infer<typeof insertRuleSchema>;
export type Rule = typeof rulesTable.$inferSelect;
