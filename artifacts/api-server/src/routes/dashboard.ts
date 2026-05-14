import { Router } from "express";
import { db } from "@workspace/db";
import {
  inboxItemsTable,
  suggestedActionsTable,
  tasksTable,
  calendarEventsTable,
  rulesTable,
  patternObservationsTable,
  auditLogTable,
} from "@workspace/db";
import { eq, and, gte, lte, lt, isNull, count, sql } from "drizzle-orm";

const router = Router();

router.get("/dashboard/summary", async (req, res) => {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 86400000);
    const weekEnd = new Date(todayStart.getTime() + 7 * 86400000);

    const [pendingInbox] = await db
      .select({ count: count() })
      .from(inboxItemsTable)
      .where(eq(inboxItemsTable.status, "ready_for_review"));

    const [todaysEvents] = await db
      .select({ count: count() })
      .from(calendarEventsTable)
      .where(
        and(
          gte(calendarEventsTable.start_at, todayStart),
          lt(calendarEventsTable.start_at, todayEnd),
        ),
      );

    const [tasksDueToday] = await db
      .select({ count: count() })
      .from(tasksTable)
      .where(
        and(
          eq(tasksTable.status, "pending"),
          gte(tasksTable.due_at, todayStart),
          lt(tasksTable.due_at, todayEnd),
        ),
      );

    const [tasksOverdue] = await db
      .select({ count: count() })
      .from(tasksTable)
      .where(
        and(eq(tasksTable.status, "pending"), lt(tasksTable.due_at, todayStart)),
      );

    const [activeRules] = await db
      .select({ count: count() })
      .from(rulesTable)
      .where(eq(rulesTable.active, true));

    const [patternsPending] = await db
      .select({ count: count() })
      .from(patternObservationsTable)
      .where(eq(patternObservationsTable.status, "suggested"));

    res.json({
      pending_inbox_count: pendingInbox.count,
      todays_events_count: todaysEvents.count,
      tasks_due_today: tasksDueToday.count,
      tasks_overdue: tasksOverdue.count,
      active_rules_count: activeRules.count,
      pattern_suggestions_pending: patternsPending.count,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get dashboard summary");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard/today-events", async (req, res) => {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 86400000);

    const events = await db
      .select()
      .from(calendarEventsTable)
      .where(
        and(
          gte(calendarEventsTable.start_at, todayStart),
          lt(calendarEventsTable.start_at, todayEnd),
        ),
      )
      .orderBy(calendarEventsTable.start_at)
      .limit(20);

    res.json(events);
  } catch (err) {
    req.log.error({ err }, "Failed to get today events");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard/upcoming-tasks", async (req, res) => {
  try {
    const now = new Date();
    const weekEnd = new Date(now.getTime() + 7 * 86400000);

    const tasks = await db
      .select()
      .from(tasksTable)
      .where(
        and(
          eq(tasksTable.status, "pending"),
          gte(tasksTable.due_at, now),
          lte(tasksTable.due_at, weekEnd),
        ),
      )
      .orderBy(tasksTable.due_at)
      .limit(10);

    const withOwner = tasks.map((t) => ({ ...t, owner_name: null }));
    res.json(withOwner);
  } catch (err) {
    req.log.error({ err }, "Failed to get upcoming tasks");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard/activity-feed", async (req, res) => {
  try {
    const items = await db
      .select()
      .from(auditLogTable)
      .orderBy(sql`${auditLogTable.timestamp} desc`)
      .limit(20);

    const feed = items.map((i) => ({
      id: i.id,
      description: i.description,
      actor: i.actor,
      timestamp: i.timestamp,
      action_type: i.action_type,
      category: i.category,
    }));

    res.json(feed);
  } catch (err) {
    req.log.error({ err }, "Failed to get activity feed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard/category-breakdown", async (req, res) => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const rows = await db
      .select({
        category: inboxItemsTable.status,
        raw: sql<string>`${inboxItemsTable.household_id}`,
      })
      .from(inboxItemsTable)
      .where(gte(inboxItemsTable.created_at, monthStart));

    // Get breakdown from suggested_actions instead
    const breakdown = await db
      .select({
        category: suggestedActionsTable.category,
        count: count(),
      })
      .from(suggestedActionsTable)
      .where(gte(suggestedActionsTable.created_at, monthStart))
      .groupBy(suggestedActionsTable.category);

    const labelMap: Record<string, string> = {
      escola: "Escola",
      saude: "Saúde",
      casa: "Casa",
      social: "Social",
      logistica: "Logística",
      refeicoes: "Refeições",
      servicos: "Serviços",
      outros: "Outros",
    };

    const result = breakdown.map((r) => ({
      category: r.category,
      count: r.count,
      label: labelMap[r.category] ?? r.category,
    }));

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to get category breakdown");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
