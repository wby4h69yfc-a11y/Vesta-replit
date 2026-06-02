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
import { eq, inArray, sql } from "drizzle-orm";
import { getHouseholdId } from "../lib/tenant";
import { getSessionId, clearSession } from "../lib/auth";

const router = Router();

// GET /privacy/export/summary — lightweight count query before the full export
router.get("/privacy/export/summary", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);

    const [
      membersCount,
      contactsCount,
      inboxCount,
      actionsCount,
      eventsCount,
      tasksCount,
      rulesCount,
      patternsCount,
      memoryCount,
      auditCount,
    ] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(membersTable).where(eq(membersTable.household_id, hid)),
      db.select({ count: sql<number>`count(*)::int` }).from(contactsTable).where(eq(contactsTable.household_id, hid)),
      db.select({ count: sql<number>`count(*)::int` }).from(inboxItemsTable).where(eq(inboxItemsTable.household_id, hid)),
      db.select({ count: sql<number>`count(*)::int` }).from(suggestedActionsTable).where(eq(suggestedActionsTable.household_id, hid)),
      db.select({ count: sql<number>`count(*)::int` }).from(calendarEventsTable).where(eq(calendarEventsTable.household_id, hid)),
      db.select({ count: sql<number>`count(*)::int` }).from(tasksTable).where(eq(tasksTable.household_id, hid)),
      db.select({ count: sql<number>`count(*)::int` }).from(rulesTable).where(eq(rulesTable.household_id, hid)),
      db.select({ count: sql<number>`count(*)::int` }).from(patternObservationsTable).where(eq(patternObservationsTable.household_id, hid)),
      db.select({ count: sql<number>`count(*)::int` }).from(memoryStagingTable).where(eq(memoryStagingTable.household_id, hid)),
      db.select({ count: sql<number>`count(*)::int` }).from(auditLogTable).where(eq(auditLogTable.household_id, hid)),
    ]);

    const c = {
      members:           membersCount[0]?.count  ?? 0,
      contacts:          contactsCount[0]?.count  ?? 0,
      inbox_items:       inboxCount[0]?.count     ?? 0,
      suggested_actions: actionsCount[0]?.count   ?? 0,
      events:            eventsCount[0]?.count     ?? 0,
      tasks:             tasksCount[0]?.count      ?? 0,
      rules:             rulesCount[0]?.count      ?? 0,
      patterns:          patternsCount[0]?.count   ?? 0,
      memory_staging:    memoryCount[0]?.count     ?? 0,
      audit_log:         auditCount[0]?.count      ?? 0,
    };

    // Rough per-record estimates (bytes): inbox/audit ~800, events/actions ~500, rest ~300
    const estimatedBytes =
      c.members           * 300 +
      c.contacts          * 300 +
      c.inbox_items       * 800 +
      c.suggested_actions * 500 +
      c.events            * 500 +
      c.tasks             * 400 +
      c.rules             * 300 +
      c.patterns          * 400 +
      c.memory_staging    * 300 +
      c.audit_log         * 800 +
      4096; // fixed envelope overhead

    res.json({ ...c, estimated_size_kb: Math.max(1, Math.round(estimatedBytes / 1024)) });
  } catch (err) {
    req.log.error({ err }, "Failed to get privacy export summary");
    res.status(500).json({ error: "Internal server error" });
  }
});

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
      // 0. Collect all user IDs linked to this household (the requester + any co-members)
      //    so we can fully clean up every account, not just the requesting user.
      const householdUsers = await tx
        .select({ id: usersTable.id, phone: usersTable.phone })
        .from(usersTable)
        .where(eq(usersTable.household_id, hid));
      const allUserIds = householdUsers.map((u) => u.id);
      // Ensure the requesting user is included even if their row is already stale
      if (!allUserIds.includes(userId)) allUserIds.push(userId);

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

      // 2. User-scoped tables — all users in the household
      if (allUserIds.length > 0) {
        await tx.delete(googleTokensTable).where(inArray(googleTokensTable.user_id, allUserIds));
        // Delete sessions for all household users via jsonb query
        await tx.execute(
          sql`DELETE FROM sessions WHERE sess->'user'->>'id' = ANY(${allUserIds}::text[])`,
        );
      }
      // OTP codes are phone-scoped — clean up all phones in the household
      const allPhones = householdUsers.map((u) => u.phone).filter((p): p is string => p != null);
      if (userPhone && !allPhones.includes(userPhone)) allPhones.push(userPhone);
      if (allPhones.length > 0) {
        await tx.delete(otpCodesTable).where(inArray(otpCodesTable.phone, allPhones));
      }

      // 3. Household row (must be before user rows so FK on users.household_id can be nulled first)
      await tx.update(usersTable).set({ household_id: null }).where(inArray(usersTable.id, allUserIds));
      await tx.delete(householdsTable).where(eq(householdsTable.id, hid));

      // 4. Delete all user rows linked to the household
      if (allUserIds.length > 0) {
        await tx.delete(usersTable).where(inArray(usersTable.id, allUserIds));
      }
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
