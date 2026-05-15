import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const contactsTable = pgTable("contacts", {
  id: serial("id").primaryKey(),
  household_id: integer("household_id").notNull(),
  name: text("name").notNull(),
  phone: text("phone"),
  whatsapp_id: text("whatsapp_id"),
  category: text("category").notNull().default("outros"),
  aliases: text("aliases").array().notNull().default([]),
  notes: text("notes"),
  status: text("status").notNull().default("confirmed"),
  source: text("source").notNull().default("user_created"),
  consent_status: text("consent_status"),
  consent_granted_at: timestamp("consent_granted_at", { withTimezone: true }),
  consent_withdrawn_at: timestamp("consent_withdrawn_at", { withTimezone: true }),
  consent_check_in_due_at: timestamp("consent_check_in_due_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertContactSchema = createInsertSchema(contactsTable).omit({ id: true, created_at: true });
export type InsertContact = z.infer<typeof insertContactSchema>;
export type Contact = typeof contactsTable.$inferSelect;
