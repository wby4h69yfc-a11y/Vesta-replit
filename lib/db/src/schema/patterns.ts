import { pgTable, text, serial, timestamp, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const patternObservationsTable = pgTable("pattern_observations", {
  id: serial("id").primaryKey(),
  household_id: integer("household_id").notNull(),
  type: text("type").notNull(),
  description: text("description").notNull(),
  occurrences: integer("occurrences").notNull().default(1),
  confidence: real("confidence").notNull().default(0.5),
  status: text("status").notNull().default("accumulating"),
  evidence: text("evidence"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPatternObservationSchema = createInsertSchema(patternObservationsTable).omit({ id: true, created_at: true, updated_at: true });
export type InsertPatternObservation = z.infer<typeof insertPatternObservationSchema>;
export type PatternObservation = typeof patternObservationsTable.$inferSelect;
