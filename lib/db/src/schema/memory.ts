import { pgTable, text, serial, timestamp, integer, jsonb, date, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { suggestedActionsTable } from "./actions";

export const householdPlacesTable = pgTable("household_places", {
  id: serial("id").primaryKey(),
  household_id: integer("household_id").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull().default("other"),
  address: text("address"),
  related_to_member_id: integer("related_to_member_id"),
  status: text("status").notNull().default("confirmed"),
  source: text("source").notNull().default("user_created"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  confirmed_at: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const householdRoutinesTable = pgTable("household_routines", {
  id: serial("id").primaryKey(),
  household_id: integer("household_id").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull().default("outros"),
  recurrence_pattern: jsonb("recurrence_pattern").notNull().$type<{
    type: "weekly" | "monthly" | "daily";
    days?: string[];
    time?: string;
    day_of_month?: string | number;
  }>(),
  involves_member_id: integer("involves_member_id"),
  responsible_member_id: integer("responsible_member_id"),
  location_id: integer("location_id"),
  effective_from: date("effective_from").notNull(),
  effective_to: date("effective_to"),
  status: text("status").notNull().default("confirmed"),
  source: text("source").notNull().default("user_created"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  confirmed_at: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const householdPreferencesTable = pgTable("household_preferences", {
  id: serial("id").primaryKey(),
  household_id: integer("household_id").notNull(),
  applies_to_member_id: integer("applies_to_member_id"),
  preference_type: text("preference_type").notNull(),
  preference_key: text("preference_key").notNull(),
  preference_value: text("preference_value").notNull(),
  effective_from: date("effective_from").notNull(),
  effective_to: date("effective_to"),
  status: text("status").notNull().default("confirmed"),
  source: text("source").notNull().default("user_created"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  confirmed_at: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memoryStagingTable = pgTable("memory_staging", {
  id: serial("id").primaryKey(),
  household_id: integer("household_id").notNull(),
  target_table: text("target_table").notNull(),
  proposed_record: jsonb("proposed_record").notNull(),
  extracted_from_inbox_id: integer("extracted_from_inbox_id"),
  context_summary: text("context_summary").notNull(),
  status: text("status").notNull().default("pending"),
  surfaced_to_user_at: timestamp("surfaced_to_user_at", { withTimezone: true }),
  responded_at: timestamp("responded_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const onboardingStateTable = pgTable("onboarding_state", {
  id: serial("id").primaryKey(),
  household_id: integer("household_id").notNull(),
  user_id: text("user_id").notNull(),
  current_step: integer("current_step").notNull().default(0),
  completed: boolean("completed").notNull().default(false),
  composition: jsonb("composition").$type<{
    adults: number;
    children: number;
    others: number;
  }>(),
  pain_points: text("pain_points").array().notNull().default([]),
  whatsapp_verified: boolean("whatsapp_verified").notNull().default(false),
  whatsapp_verified_phone: text("whatsapp_verified_phone"),
  calendar_connected: boolean("calendar_connected").notNull().default(false),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const waConversationsTable = pgTable(
  "wa_conversations",
  {
    id: serial("id").primaryKey(),
    household_id: integer("household_id").notNull(),
    sender_phone: text("sender_phone").notNull(),
    /** awaiting_confirmation | awaiting_edit | completed | dismissed */
    state: text("state").notNull().default("awaiting_confirmation"),
    /**
     * Twilio MessageSid of the inbound message that opened this conversation.
     * Nullable — populated on creation; used for thread-level traceability.
     */
    thread_id: text("thread_id"),
    /** FK to suggested_actions.id — the action being proposed to this sender */
    pending_action_id: integer("pending_action_id").references(
      () => suggestedActionsTable.id,
      { onDelete: "set null" },
    ),
    /**
     * Snapshot of the proposed action. `artifact_id` is written back on
     * approval so undo can reverse the exact created task/event row.
     */
    proposed_payload: jsonb("proposed_payload").$type<{
      title: string;
      type: string | null;
      category: string | null;
      datetime: string | null;
      artifact_id?: number;
    }>(),
    /** Slot for future context types: 'approval' | 'rating_request' */
    thread_context: text("thread_context").default("approval"),
    last_message_at: timestamp("last_message_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Hard expiry — rows older than this are silently dismissed by the cleanup tick */
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("wa_conversations_lookup_idx").on(
      table.household_id,
      table.sender_phone,
      table.state,
      table.expires_at,
    ),
  ],
);

export type WaConversation = typeof waConversationsTable.$inferSelect;

export type HouseholdPlace = typeof householdPlacesTable.$inferSelect;
export type HouseholdRoutine = typeof householdRoutinesTable.$inferSelect;
export type HouseholdPreference = typeof householdPreferencesTable.$inferSelect;
export type MemoryStaging = typeof memoryStagingTable.$inferSelect;
export type OnboardingState = typeof onboardingStateTable.$inferSelect;

export const insertPlaceSchema = createInsertSchema(householdPlacesTable).omit({ id: true, created_at: true, confirmed_at: true });
export type InsertPlace = z.infer<typeof insertPlaceSchema>;
