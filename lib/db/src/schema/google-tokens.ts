import { pgTable, serial, varchar, timestamp, text } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const googleTokensTable = pgTable("google_tokens", {
  id: serial("id").primaryKey(),
  user_id: varchar("user_id")
    .notNull()
    .unique()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  access_token: text("access_token").notNull(),
  refresh_token: text("refresh_token"),
  expiry: timestamp("expiry", { withTimezone: true }),
  scopes: text("scopes"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GoogleToken = typeof googleTokensTable.$inferSelect;
export type InsertGoogleToken = typeof googleTokensTable.$inferInsert;
