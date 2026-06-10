import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";

export const remindersTable = pgTable(
  "reminders",
  {
    id: serial("id").primaryKey(),
    household_id: integer("household_id").notNull(),
    /** Normalised sender phone (digits only) — used to deliver the reminder back to them. */
    member_phone: text("member_phone").notNull(),
    /** What to remind about — the message Vesta will send at remind_at. */
    message: text("message").notNull(),
    /** When to fire the reminder (timestamptz). Stored in UTC. */
    remind_at: timestamp("remind_at", { withTimezone: true }).notNull(),
    /** RFC 5545 RRULE string for recurring reminders, e.g. FREQ=WEEKLY. Null for one-shot. */
    rrule: text("rrule"),
    /** Set when the reminder was fired. Null = not yet fired. */
    fired_at: timestamp("fired_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("reminders_remind_at_fired_at_idx").on(table.remind_at, table.fired_at),
    index("reminders_household_id_idx").on(table.household_id),
  ],
);

export type Reminder = typeof remindersTable.$inferSelect;
