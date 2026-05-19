import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, onboardingStateTable, sessionsTable } from "@workspace/db";

const router: IRouter = Router();

/**
 * Dev-only routes. Guarded at mount time — only registered when
 * NODE_ENV !== "production". Never call getHouseholdId here; these routes
 * exist precisely to fix/reset state before a household is confirmed.
 */

if (process.env.NODE_ENV !== "production") {
  /**
   * POST /api/dev/reset-onboarding
   *
   * Resets the authenticated user's onboarding state back to step 0 so
   * the full flow can be retested without touching the DB directly.
   */
  router.post(
    "/dev/reset-onboarding",
    async (req: Request, res: Response) => {
      if (!req.isAuthenticated()) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const userId = req.user.id;

      await db
        .update(onboardingStateTable)
        .set({
          completed: false,
          current_step: 0,
          whatsapp_verified: false,
          calendar_connected: false,
          updated_at: new Date(),
        })
        .where(eq(onboardingStateTable.user_id, userId));

      req.log.info({ userId }, "Onboarding state reset (dev)");
      res.json({ ok: true, message: "Onboarding reset to step 0" });
    },
  );

  /**
   * POST /api/dev/complete-onboarding
   *
   * Fast-forwards onboarding to completed so you can test the main app
   * without going through the flow.
   */
  router.post(
    "/dev/complete-onboarding",
    async (req: Request, res: Response) => {
      if (!req.isAuthenticated()) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const userId = req.user.id;

      await db
        .update(onboardingStateTable)
        .set({
          completed: true,
          current_step: 7,
          updated_at: new Date(),
        })
        .where(eq(onboardingStateTable.user_id, userId));

      req.log.info({ userId }, "Onboarding fast-forwarded to complete (dev)");
      res.json({ ok: true, message: "Onboarding marked complete" });
    },
  );

  /**
   * DELETE /api/dev/session
   *
   * Clears the current session cookie so you can test the login flow
   * without opening the browser's DevTools.
   */
  router.delete("/dev/session", async (req: Request, res: Response) => {
    const sid = req.cookies?.sid;
    if (sid) {
      await db.delete(sessionsTable).where(eq(sessionsTable.sid, sid));
    }
    res.clearCookie("sid", { path: "/" });
    res.json({ ok: true, message: "Session cleared" });
  });
}

export default router;
