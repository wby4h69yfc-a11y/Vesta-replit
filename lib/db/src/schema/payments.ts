import { pgTable, text, serial, timestamp, integer, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const paymentObligationsTable = pgTable(
  "payment_obligations",
  {
    id: serial("id").primaryKey(),
    household_id: integer("household_id").notNull(),
    source_inbox_id: integer("source_inbox_id"),
    description: text("description").notNull(),
    recipient: text("recipient"),
    amount_cents: integer("amount_cents"),
    currency: text("currency").notNull().default("BRL"),
    due_date: text("due_date"),
    is_recurring: boolean("is_recurring").notNull().default(false),
    recurrence_pattern: text("recurrence_pattern"),
    owner_id: integer("owner_id"),
    paid_by_id: integer("paid_by_id"),
    reimbursement_owed_by_id: integer("reimbursement_owed_by_id"),
    payment_method: text("payment_method"),
    status: text("status").notNull().default("pending"),
    paid_at: timestamp("paid_at", { withTimezone: true }),
    proof_url: text("proof_url"),
    reimbursement_note: text("reimbursement_note"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    index("payment_obligations_household_idx").on(table.household_id, table.status),
    index("payment_obligations_reimbursement_idx").on(table.household_id, table.reimbursement_owed_by_id),
  ],
);

export type PaymentObligation = typeof paymentObligationsTable.$inferSelect;
export const insertPaymentObligationSchema = createInsertSchema(paymentObligationsTable).omit({ id: true, created_at: true, updated_at: true });
export type InsertPaymentObligation = z.infer<typeof insertPaymentObligationSchema>;
