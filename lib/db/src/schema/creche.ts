import { pgTable, text, serial, timestamp, integer, jsonb, date, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const crecheWaitlistsTable = pgTable(
  "creche_waitlists",
  {
    id: serial("id").primaryKey(),
    household_id: integer("household_id").notNull(),
    creche_name: text("creche_name").notNull(),
    child_id: integer("child_id"),
    status: text("status").notNull().default("waiting"),
    registered_at: date("registered_at", { mode: "string" }),
    estimated_call_date: date("estimated_call_date", { mode: "string" }),
    next_followup_at: timestamp("next_followup_at", { withTimezone: true }),
    document_checklist: jsonb("document_checklist")
      .$type<Array<{ doc: string; done: boolean }>>()
      .default([]),
    notes: text("notes"),
    source_inbox_id: integer("source_inbox_id"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    index("creche_waitlists_household_status_idx").on(table.household_id, table.status),
  ],
);

export type CrecheWaitlist = typeof crecheWaitlistsTable.$inferSelect;
export const insertCrecheWaitlistSchema = createInsertSchema(crecheWaitlistsTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type InsertCrecheWaitlist = z.infer<typeof insertCrecheWaitlistSchema>;
