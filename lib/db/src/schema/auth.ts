import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, timestamp, varchar, serial } from "drizzle-orm/pg-core";


// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const sessionsTable = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const usersTable = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  phone: varchar("phone", { length: 20 }).unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  googleId: varchar("google_id").unique(),
  appleId: varchar("apple_id").unique(),
  household_id: integer("household_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const otpCodesTable = pgTable("otp_codes", {
  id: serial("id").primaryKey(),
  phone: varchar("phone", { length: 20 }).notNull(),
  code: varchar("code", { length: 6 }).notNull(),
  expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
  used_at: timestamp("used_at", { withTimezone: true }),
  failed_attempts: integer("failed_attempts").notNull().default(0),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Cross-instance OTP rate limit buckets — keyed by "send:phone:+55…", "send:ip:…", etc.
// A single atomic INSERT … ON CONFLICT DO UPDATE enforces the window without a scheduler.
export const otpRateLimitsTable = pgTable("otp_rate_limits", {
  key: varchar("key", { length: 255 }).primaryKey(),
  count: integer("count").notNull().default(1),
  window_start: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
});

export type UpsertUser = typeof usersTable.$inferInsert;
export type User = typeof usersTable.$inferSelect;
export type OtpCode = typeof otpCodesTable.$inferSelect;
