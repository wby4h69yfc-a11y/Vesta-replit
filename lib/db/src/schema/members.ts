import { pgTable, text, serial, timestamp, integer, varchar, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const membersTable = pgTable("members", {
  id: serial("id").primaryKey(),
  household_id: integer("household_id").notNull(),
  user_id: varchar("user_id"),
  name: text("name").notNull(),
  display_name: text("display_name"),
  role: text("role").notNull().default("member"),
  relationship_type: text("relationship_type").notNull().default("adult"),
  phone: text("phone"),
  /**
   * True only when `phone` was set through the WhatsApp onboarding token flow,
   * meaning the member physically sent a message from that number to prove
   * ownership. Admin-set phones default to false and are NOT used for inbound
   * WhatsApp routing — only for display and outbound messaging.
   */
  phone_verified: boolean("phone_verified").notNull().default(false),
  avatar_url: text("avatar_url"),
  colour: text("colour"),
  birth_year: integer("birth_year"),
  school: text("school"),
  grade: text("grade"),
  primary_doctor: text("primary_doctor"),
  schedule: text("schedule"),
  medical_plan: text("medical_plan"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMemberSchema = createInsertSchema(membersTable).omit({ id: true, created_at: true });
export type InsertMember = z.infer<typeof insertMemberSchema>;
export type Member = typeof membersTable.$inferSelect;
