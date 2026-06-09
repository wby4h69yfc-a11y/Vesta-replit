import { pgTable, text, integer, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Shared cross-instance rate limit counters for per-sender WhatsApp media
 * processing. Replacing the former in-process Map so the limit is enforced
 * globally across all autoscaled API instances.
 *
 * Each row tracks one normalised sender phone number.  A single atomic upsert
 * (INSERT … ON CONFLICT DO UPDATE) increments the counter or resets it when
 * the 1-hour window has expired, ensuring consistency without application-level
 * locking.
 */
export const waMediaRateLimitsTable = pgTable(
  "wa_media_rate_limits",
  {
    phone_norm: text("phone_norm").primaryKey(),
    count: integer("count").notNull().default(1),
    window_start: timestamp("window_start", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("wa_media_rate_limits_window_start_idx").on(table.window_start),
  ],
);

export type WaMediaRateLimit = typeof waMediaRateLimitsTable.$inferSelect;
