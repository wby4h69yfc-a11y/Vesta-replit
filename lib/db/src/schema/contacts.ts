import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const contactsTable = pgTable(
  "contacts",
  {
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
    last_consent_requested_at: timestamp("last_consent_requested_at", { withTimezone: true }),

    // ── Service reliability fields (§19.3) ──────────────────────────────────
    /** Sub-category for service providers (diarista, eletricista, etc.) */
    service_category: text("service_category"),
    /** Provider reliability status: preferred / backup / avoid / untested */
    reliability_status: text("reliability_status").notNull().default("untested"),
    /** Timestamp of the last recorded service interaction */
    last_used_at: timestamp("last_used_at", { withTimezone: true }),
    /** Free-text price anchor, e.g. "R$80–120" */
    last_price_range: text("last_price_range"),
    /** Number of confirmed no-shows */
    no_show_count: integer("no_show_count").notNull().default(0),
    /** Payment and billing notes */
    payment_notes: text("payment_notes"),
    /** Household quality rating 1–5 (latest) */
    household_rating: integer("household_rating"),
    /** Free-text reliability notes */
    reliability_notes: text("reliability_notes"),
    /** Last individual rating keyword for consecutive-bom detection */
    last_rating: text("last_rating"),

    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("contacts_provider_idx").on(
      table.household_id,
      table.service_category,
      table.reliability_status,
    ),
  ],
);

export const insertContactSchema = createInsertSchema(contactsTable).omit({ id: true, created_at: true });
export type InsertContact = z.infer<typeof insertContactSchema>;
export type Contact = typeof contactsTable.$inferSelect;
