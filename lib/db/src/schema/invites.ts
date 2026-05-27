import { pgTable, text, serial, timestamp, integer, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const householdInvitesTable = pgTable("household_invites", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 16 }).notNull().unique(),
  household_id: integer("household_id").notNull(),
  invited_phone: text("invited_phone").notNull(),
  invited_by_user_id: varchar("invited_by_user_id"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
  accepted_at: timestamp("accepted_at", { withTimezone: true }),
});

export const insertHouseholdInviteSchema = createInsertSchema(householdInvitesTable).omit({
  id: true,
  created_at: true,
});
export type InsertHouseholdInvite = z.infer<typeof insertHouseholdInviteSchema>;
export type HouseholdInvite = typeof householdInvitesTable.$inferSelect;
