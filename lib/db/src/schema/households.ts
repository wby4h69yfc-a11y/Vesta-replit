import { pgTable, text, serial, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const householdsTable = pgTable("households", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  location: text("location"),
  plan: text("plan").notNull().default("free"),
  concierge_eligible: boolean("concierge_eligible").notNull().default(false),
  last_briefing_sent_at: timestamp("last_briefing_sent_at", { withTimezone: true }),
  briefing_hour: integer("briefing_hour").notNull().default(7),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertHouseholdSchema = createInsertSchema(householdsTable).omit({ id: true, created_at: true });
export type InsertHousehold = z.infer<typeof insertHouseholdSchema>;
export type Household = typeof householdsTable.$inferSelect;
