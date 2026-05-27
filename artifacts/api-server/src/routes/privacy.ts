import { Router } from "express";
import { db } from "@workspace/db";
import {
  householdsTable,
  membersTable,
  contactsTable,
  inboxItemsTable,
  suggestedActionsTable,
  calendarEventsTable,
  tasksTable,
  rulesTable,
  patternObservationsTable,
  memoryStagingTable,
  auditLogTable,
  onboardingStateTable,
  googleTokensTable,
  householdInvitesTable,
  householdPlacesTable,
  householdRoutinesTable,
  householdPreferencesTable,
  usersTable,
  otpCodesTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { getHouseholdId } from "../lib/tenant";
import { getSessionId, clearSession } from "../lib/auth";

const router = Router();

// GET /privacy/export — LGPD Art. 18 V: data portability
router.get("/privacy/export", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const userId = req.user!.id;

    const [
      household,
      members,
      contacts,
      inboxItems,
      suggestedActions,
      events,
      tasks,
      rules,
      patterns,
      memoryStaging,
      auditLog,
    ] = await Promise.all([
      db.select().from(householdsTable).where(eq(householdsTable.id, hid)),
      db.select().from(membersTable).where(eq(membersTable.household_id, hid)),
      db.select().from(contactsTable).where(eq(contactsTable.household_id, hid)),
      db.select().from(inboxItemsTable).where(eq(inboxItemsTable.household_id, hid)),
      db.select().from(suggestedActionsTable).where(eq(suggestedActionsTable.household_id, hid)),
      db.select().from(calendarEventsTable).where(eq(calendarEventsTable.household_id, hid)),
      db.select().from(tasksTable).where(eq(tasksTable.household_id, hid)),
      db.select().from(rulesTable).where(eq(rulesTable.household_id, hid)),
      db.select().from(patternObservationsTable).where(eq(patternObservationsTable.household_id, hid)),
      db.select().from(memoryStagingTable).where(eq(memoryStagingTable.household_id, hid)),
      db.select().from(auditLogTable).where(eq(auditLogTable.household_id, hid)),
    ]);

    const payload = {
      exported_at: new Date().toISOString(),
      user_id: userId,
      household: household[0] ?? null,
      members,
      contacts,
      inbox_items: inboxItems,
      suggested_actions: suggestedActions,
      events,
      tasks,
      rules,
      patterns,
      memory_staging: memoryStaging,
      audit_log: auditLog,
    };

    res.setHeader("Content-Disposition", "attachment; filename=\"vesta-export.json\"");
    res.setHeader("Content-Type", "application/json");
    res.json(payload);
  } catch (err) {
    req.log.error({ err }, "Failed to export privacy data");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /account — LGPD Art. 18 VI: erasure
router.delete("/account", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const userId = req.user!.id;
    const userPhone = req.user!.phone ?? null;

    await db.transaction(async (tx) => {
      // 1. Cascade through household-scoped tables (FK-safe order)
      await tx.delete(suggestedActionsTable).where(eq(suggestedActionsTable.household_id, hid));
      await tx.delete(inboxItemsTable).where(eq(inboxItemsTable.household_id, hid));
      await tx.delete(calendarEventsTable).where(eq(calendarEventsTable.household_id, hid));
      await tx.delete(tasksTable).where(eq(tasksTable.household_id, hid));
      await tx.delete(rulesTable).where(eq(rulesTable.household_id, hid));
      await tx.delete(patternObservationsTable).where(eq(patternObservationsTable.household_id, hid));
      await tx.delete(memoryStagingTable).where(eq(memoryStagingTable.household_id, hid));
      await tx.delete(householdPlacesTable).where(eq(householdPlacesTable.household_id, hid));
      await tx.delete(householdRoutinesTable).where(eq(householdRoutinesTable.household_id, hid));
      await tx.delete(householdPreferencesTable).where(eq(householdPreferencesTable.household_id, hid));
      await tx.delete(auditLogTable).where(eq(auditLogTable.household_id, hid));
      await tx.delete(contactsTable).where(eq(contactsTable.household_id, hid));
      await tx.delete(membersTable).where(eq(membersTable.household_id, hid));
      await tx.delete(onboardingStateTable).where(eq(onboardingStateTable.household_id, hid));
      await tx.delete(householdInvitesTable).where(eq(householdInvitesTable.household_id, hid));

      // 2. User-scoped tables
      await tx.delete(googleTokensTable).where(eq(googleTokensTable.user_id, userId));
      if (userPhone) {
        await tx.delete(otpCodesTable).where(eq(otpCodesTable.phone, userPhone));
      }

      // 3. Sessions for this user (sess is jsonb with {user: {id: ...}} shape)
      await tx.execute(
        sql`DELETE FROM sessions WHERE sess->'user'->>'id' = ${userId}`,
      );

      // 4. Household and user rows
      await tx.update(usersTable).set({ household_id: null }).where(eq(usersTable.id, userId));
      await tx.delete(householdsTable).where(eq(householdsTable.id, hid));
      await tx.delete(usersTable).where(eq(usersTable.id, userId));
    });

    // Clear the current session cookie
    const sid = getSessionId(req);
    await clearSession(res, sid);
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete account");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
