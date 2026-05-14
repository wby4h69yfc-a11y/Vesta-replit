import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tasksTable = pgTable("tasks", {
  id: serial("id").primaryKey(),
  household_id: integer("household_id").notNull().default(1),
  title: text("title").notNull(),
  owner_id: integer("owner_id"),
  due_at: timestamp("due_at", { withTimezone: true }),
  status: text("status").notNull().default("pending"),
  category: text("category"),
  linked_event_id: integer("linked_event_id"),
  workflow_tags: text("workflow_tags").array().notNull().default([]),
  completed_at: timestamp("completed_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTaskSchema = createInsertSchema(tasksTable).omit({ id: true, created_at: true, updated_at: true });
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasksTable.$inferSelect;
