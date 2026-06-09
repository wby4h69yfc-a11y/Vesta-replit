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
  timezone: text("timezone").notNull().default("America/Sao_Paulo"),
  /** Whether the proactive daily digest is enabled for this household */
  digest_enabled: boolean("digest_enabled").notNull().default(true),
  /** When set, proactive messages are suppressed until this timestamp (PAUSAR command) */
  digest_paused_until: timestamp("digest_paused_until", { withTimezone: true }),
  /** When true, all proactive messages are permanently stopped (PARAR command) */
  digest_stopped: boolean("digest_stopped").notNull().default(false),
  /** Local hour (0-23) at which the quiet window starts — messages scheduled after this are held until quiet_hour_end */
  quiet_hour_start: integer("quiet_hour_start").notNull().default(21),
  /** Local hour (0-23) at which the quiet window ends — held messages are released at this hour */
  quiet_hour_end: integer("quiet_hour_end").notNull().default(7),
  /** Number of consecutive failed WhatsApp delivery attempts (briefing or proactive). Resets to 0 on any successful send. */
  whatsapp_consecutive_failures: integer("whatsapp_consecutive_failures").notNull().default(0),
  /** Timestamp of the most recent failed WhatsApp delivery attempt. */
  whatsapp_last_failure_at: timestamp("whatsapp_last_failure_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertHouseholdSchema = createInsertSchema(householdsTable).omit({ id: true, created_at: true });
export type InsertHousehold = z.infer<typeof insertHouseholdSchema>;
export type Household = typeof householdsTable.$inferSelect;
