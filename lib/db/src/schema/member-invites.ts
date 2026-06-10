import { pgTable, serial, integer, varchar, timestamp } from "drizzle-orm/pg-core";

export const memberInvitesTable = pgTable("member_invites", {
  id: serial("id").primaryKey(),
  household_id: integer("household_id").notNull(),
  member_id: integer("member_id").notNull(),
  token: varchar("token", { length: 20 }).notNull().unique(),
  expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
  used_at: timestamp("used_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MemberInvite = typeof memberInvitesTable.$inferSelect;
