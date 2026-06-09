import { Router, type IRouter, type Request, type Response } from "express";
import { db, usersTable, householdsTable, onboardingStateTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createSession, SESSION_COOKIE, SESSION_TTL, type SessionData } from "../lib/auth";
import { runConsentRenewalJob } from "../lib/consent-renewal-scheduler";

const router: IRouter = Router();

if (process.env.NODE_ENV !== "production") {
  /**
   * GET /api/dev/test-login
   *
   * Dev/test only. Creates a fully authenticated test session for the given
   * user, complete with a household and completed onboarding, then sets the
   * session cookie and redirects the browser.
   *
   * Query params:
   *   user_id   — user identifier (defaults to a random "test-<8chars>" string)
   *   email     — email for the user (defaults to "<user_id>@test.example.com")
   *   return_to — path to redirect to after login (defaults to "/")
   *
   * NEVER exposed in production (guarded by the NODE_ENV check above).
   */
  router.get("/dev/test-login", async (req: Request, res: Response) => {
    const rawUserId = typeof req.query.user_id === "string" ? req.query.user_id : null;
    const userId = rawUserId ?? `test-${Math.random().toString(36).slice(2, 10)}`;
    const email =
      typeof req.query.email === "string" ? req.query.email : `${userId}@test.example.com`;

    const rawReturnTo = typeof req.query.return_to === "string" ? req.query.return_to : "";
    const returnTo =
      typeof rawReturnTo === "string" && rawReturnTo.startsWith("/") && !rawReturnTo.startsWith("//")
        ? rawReturnTo
        : "/";

    // Upsert user
    await db
      .insert(usersTable)
      .values({ id: userId, email, firstName: "Test", lastName: "E2E", profileImageUrl: null })
      .onConflictDoUpdate({
        target: usersTable.id,
        set: { email, firstName: "Test", lastName: "E2E" },
      });

    // Fetch or create household
    const [existingUser] = await db
      .select({ household_id: usersTable.household_id })
      .from(usersTable)
      .where(eq(usersTable.id, userId));

    let householdId = existingUser?.household_id ?? null;
    if (!householdId) {
      const [hh] = await db
        .insert(householdsTable)
        .values({ name: "Casa de Teste", plan: "free" })
        .returning();
      householdId = hh.id;
      await db
        .update(usersTable)
        .set({ household_id: householdId })
        .where(eq(usersTable.id, userId));
    }

    // Insert onboarding_state with completed=true (only if not present)
    const [existingOnboarding] = await db
      .select({ id: onboardingStateTable.id })
      .from(onboardingStateTable)
      .where(eq(onboardingStateTable.user_id, userId));

    if (existingOnboarding) {
      await db
        .update(onboardingStateTable)
        .set({ completed: true, current_step: 8 })
        .where(eq(onboardingStateTable.user_id, userId));
    } else {
      await db
        .insert(onboardingStateTable)
        .values({ user_id: userId, household_id: householdId, completed: true, current_step: 8 });
    }

    // Create session
    const sessionData: SessionData = {
      user: {
        id: userId,
        email,
        firstName: "Test",
        lastName: "E2E",
        profileImageUrl: null,
        household_id: householdId,
      },
      access_token: "dev-test-token",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    };
    const sid = await createSession(sessionData);

    res.cookie(SESSION_COOKIE, sid, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_TTL,
      path: "/",
    });

    res.redirect(returnTo);
  });

  /**
   * POST /api/dev/run-consent-renewal
   *
   * Dev/test only. Runs the consent renewal scheduler job synchronously and
   * returns when complete.  No auth required so tests can call it without a
   * session cookie (mirrors the public webhook pattern used by E2E tests).
   *
   * NEVER exposed in production (guarded by the NODE_ENV check above).
   */
  router.post("/dev/run-consent-renewal", async (_req: Request, res: Response) => {
    try {
      await runConsentRenewalJob();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  });
}

export default router;
