import { Router, type IRouter, type Request, type Response } from "express";
import { sql, count, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable,
  householdsTable,
  onboardingStateTable,
  inboxItemsTable,
  suggestedActionsTable,
} from "@workspace/db";

const router: IRouter = Router();

/**
 * Admin auth guard: any authenticated user in development.
 * In production, restrict to emails listed in ADMIN_EMAILS (comma-separated).
 */
function isAdmin(req: Request): boolean {
  if (!req.isAuthenticated() || !req.user) return false;
  const adminEmails = process.env.ADMIN_EMAILS;
  if (!adminEmails || process.env.NODE_ENV !== "production") return true;
  const list = adminEmails.split(",").map((e) => e.trim().toLowerCase());
  return list.includes((req.user.email ?? "").toLowerCase());
}

/**
 * GET /api/admin/stats
 *
 * Returns aggregated platform stats for the admin dashboard.
 */
router.get("/admin/stats", async (req: Request, res: Response) => {
  if (!isAdmin(req)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  try {
    // ── Summary counts ────────────────────────────────────────────────────────
    const [totalUsers] = await db.select({ count: count() }).from(usersTable);
    const [totalHouseholds] = await db.select({ count: count() }).from(householdsTable);

    const [onboardingComplete] = await db
      .select({ count: count() })
      .from(onboardingStateTable)
      .where(eq(onboardingStateTable.completed, true));

    const [waVerified] = await db
      .select({ count: count() })
      .from(onboardingStateTable)
      .where(eq(onboardingStateTable.whatsapp_verified, true));

    const [calConnected] = await db
      .select({ count: count() })
      .from(onboardingStateTable)
      .where(eq(onboardingStateTable.calendar_connected, true));

    const [totalInbox] = await db.select({ count: count() }).from(inboxItemsTable);

    const [totalActions] = await db.select({ count: count() }).from(suggestedActionsTable);

    const [actionsApproved] = await db
      .select({ count: count() })
      .from(suggestedActionsTable)
      .where(eq(suggestedActionsTable.status, "approved"));

    const [actionsRejected] = await db
      .select({ count: count() })
      .from(suggestedActionsTable)
      .where(eq(suggestedActionsTable.status, "rejected"));

    const [actionsPending] = await db
      .select({ count: count() })
      .from(suggestedActionsTable)
      .where(eq(suggestedActionsTable.status, "pending"));

    // ── Sign-ups per day (last 30 days) ───────────────────────────────────────
    const signupsByDay = await db.execute(sql`
      SELECT
        date_trunc('day', "created_at") AS day,
        COUNT(*)::int AS cnt
      FROM users
      WHERE created_at >= now() - interval '30 days'
      GROUP BY 1
      ORDER BY 1 ASC
    `);

    // ── Inbox items per day (last 30 days) ────────────────────────────────────
    const inboxByDay = await db.execute(sql`
      SELECT
        date_trunc('day', created_at) AS day,
        COUNT(*)::int AS cnt
      FROM inbox_items
      WHERE created_at >= now() - interval '30 days'
      GROUP BY 1
      ORDER BY 1 ASC
    `);

    // ── Actions by category (top 8) ───────────────────────────────────────────
    const actionsByCategory = await db.execute(sql`
      SELECT
        category,
        COUNT(*)::int AS cnt
      FROM suggested_actions
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 8
    `);

    // ── Recent sign-ups (last 20) ─────────────────────────────────────────────
    const recentUsers = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        createdAt: usersTable.createdAt,
        household_id: usersTable.household_id,
      })
      .from(usersTable)
      .orderBy(sql`${usersTable.createdAt} DESC`)
      .limit(20);

    // ── Inbox items by source ─────────────────────────────────────────────────
    const inboxBySource = await db.execute(sql`
      SELECT source, COUNT(*)::int AS cnt
      FROM inbox_items
      GROUP BY 1
      ORDER BY 2 DESC
    `);

    res.json({
      summary: {
        total_users:         totalUsers.count,
        total_households:    totalHouseholds.count,
        onboarding_complete: onboardingComplete.count,
        whatsapp_verified:   waVerified.count,
        calendar_connected:  calConnected.count,
        total_inbox_items:   totalInbox.count,
        total_actions:       totalActions.count,
        actions_approved:    actionsApproved.count,
        actions_rejected:    actionsRejected.count,
        actions_pending:     actionsPending.count,
      },
      signups_by_day:    signupsByDay.rows,
      inbox_by_day:      inboxByDay.rows,
      actions_by_category: actionsByCategory.rows,
      inbox_by_source:   inboxBySource.rows,
      recent_users:      recentUsers,
    });
  } catch (err) {
    req.log.error({ err }, "Admin stats query failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
