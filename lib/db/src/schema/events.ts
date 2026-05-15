import { pgTable, text, serial, timestamp, integer, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const calendarEventsTable = pgTable("calendar_events", {
  id: serial("id").primaryKey(),
  household_id: integer("household_id").notNull().default(1),
  title: text("title").notNull(),
  start_at: timestamp("start_at", { withTimezone: true }).notNull(),
  end_at: timestamp("end_at", { withTimezone: true }),
  all_day: boolean("all_day").notNull().default(false),
  category: text("category").notNull().default("outros"),
  members: text("members").array().notNull().default([]),
  source: text("source").notNull().default("manual"),
  sync_status: text("sync_status").notNull().default("local"),
  gcal_event_id: text("gcal_event_id"),
  notes: text("notes"),
  workflow_tags: text("workflow_tags").array().notNull().default([]),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
},
(table) => [uniqueIndex("calendar_events_gcal_event_id_idx").on(table.gcal_event_id)],
);

export const insertCalendarEventSchema = createInsertSchema(calendarEventsTable).omit({ id: true, created_at: true, updated_at: true });
export type InsertCalendarEvent = z.infer<typeof insertCalendarEventSchema>;
export type CalendarEvent = typeof calendarEventsTable.$inferSelect;
