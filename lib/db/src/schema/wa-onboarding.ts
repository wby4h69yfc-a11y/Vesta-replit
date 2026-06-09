import { pgTable, text, serial, timestamp, jsonb, boolean, index } from "drizzle-orm/pg-core";

export type WaOnboardingStep =
  | "WELCOME"
  | "NAME_CITY"
  | "HOUSEHOLD_COMPOSITION"
  | "RULE_TEMPLATES"
  | "COMPLETE";

export interface WaOnboardingData {
  name?: string;
  city?: string;
  adults?: number;
  children?: number;
  selectedTemplates?: string[];
}

/**
 * Persists in-progress WhatsApp-native onboarding sessions.
 *
 * - One row per phone number (unique constraint).
 * - Expires 24 hours after creation so abandoned sessions don't block
 *   a second attempt from the same number.
 * - `lgpd_accepted` gates all data collection — nothing is stored for the
 *   user until they reply ACEITO in the WELCOME step.
 * - `magic_token` + `magic_token_expires_at` are written on COMPLETE so the
 *   user can claim a web session by clicking the link sent in the final reply.
 */
export const waOnboardingSessionsTable = pgTable(
  "wa_onboarding_sessions",
  {
    id: serial("id").primaryKey(),
    phone: text("phone").notNull().unique(),
    step: text("step").notNull().default("WELCOME").$type<WaOnboardingStep>(),
    data: jsonb("data").notNull().default({}).$type<WaOnboardingData>(),
    lgpd_accepted: boolean("lgpd_accepted").notNull().default(false),
    /** Numeric user id created at COMPLETE — null until then */
    created_user_id: text("created_user_id"),
    /** One-time token for the web magic-link claim */
    magic_token: text("magic_token"),
    magic_token_expires_at: timestamp("magic_token_expires_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Set when the ~23h re-engagement reminder has been sent to this phone. */
    reminder_sent_at: timestamp("reminder_sent_at", { withTimezone: true }),
  },
  (table) => [
    index("wa_onboarding_sessions_phone_idx").on(table.phone),
    index("wa_onboarding_sessions_expires_idx").on(table.expires_at),
    index("wa_onboarding_sessions_magic_idx").on(table.magic_token),
  ],
);

export type WaOnboardingSession = typeof waOnboardingSessionsTable.$inferSelect;
