import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth, requireHousehold } from "../middlewares/authMiddleware";
import healthRouter from "./health";
import authRouter from "./auth";
import authOtpRouter from "./auth-otp";
import authSocialRouter from "./auth-social";
import webhookRouter from "./webhook";
import dashboardRouter from "./dashboard";
import inboxRouter from "./inbox";
import actionsRouter from "./actions";
import tasksRouter from "./tasks";
import eventsRouter from "./events";
import contactsRouter from "./contacts";
import rulesRouter from "./rules";
import householdRouter from "./household";
import patternsRouter from "./patterns";
import onboardingRouter from "./onboarding";
import googleRouter from "./google";
import briefingRouter from "./briefing";
import adminRouter from "./admin";
import devRouter from "./dev";

const router: IRouter = Router();

// ── Public routes (no session required) ───────────────────────────────────────
// IMPORTANT: only routes that must be reachable without a valid session belong
// here. Adding a business route here instead of protectedRouter below would
// silently open it to unauthenticated access.
router.use(healthRouter);    // GET /health
router.use(authRouter);      // GET /login, GET /callback, GET /logout, GET /auth/user, POST /mobile-auth/*
router.use(authOtpRouter);   // POST /auth/otp/send, POST /auth/otp/verify
router.use(authSocialRouter); // GET /auth/google, GET /auth/google/callback, POST /auth/apple/callback
router.use(webhookRouter);   // POST /webhook/whatsapp (authenticated via Twilio HMAC)

// ── Dev-only routes (auth required, no household check) ───────────────────────
// Only registered when NODE_ENV !== "production". Useful for resetting state
// during development without touching the DB directly.
if (process.env.NODE_ENV !== "production") {
  const devProtected: IRouter = Router();
  devProtected.use(requireAuth);
  devProtected.use(devRouter); // POST /dev/reset-onboarding, POST /dev/complete-onboarding, DELETE /dev/session
  router.use(devProtected);
}

// ── Protected routes (session required + household assigned) ───────────────────
// requireAuth:      returns 401 for requests without a valid session.
// requireHousehold: returns 409 for authenticated users who have not yet been
//                   assigned a household (edge-case guard for legacy sessions).
//
// Every household data access in these sub-routers calls getHouseholdId(req)
// which reads req.user.household_id — guaranteed non-null by requireHousehold —
// and scopes every SELECT, INSERT, UPDATE, and DELETE to that household's rows.
// Cross-household reads and writes are structurally impossible because the
// household ID comes from the authenticated session, not from the request body
// or query string.
const protectedRouter: IRouter = Router();
protectedRouter.use(requireAuth);
protectedRouter.use(requireHousehold);

protectedRouter.use(dashboardRouter);  // GET /dashboard/*
protectedRouter.use(inboxRouter);      // GET|POST /inbox, GET|POST /inbox/:id/*
protectedRouter.use(actionsRouter);    // GET /actions, POST /actions/:id/*
protectedRouter.use(tasksRouter);      // GET|POST|PATCH|DELETE /tasks, POST /tasks/:id/complete
protectedRouter.use(eventsRouter);     // GET|POST|PATCH|DELETE /events
protectedRouter.use(contactsRouter);  // GET|POST|PATCH|DELETE /contacts, POST /contacts/bulk
protectedRouter.use(rulesRouter);      // GET|POST|PATCH|DELETE|POST /rules, POST /rules/:id/toggle
protectedRouter.use(householdRouter);  // GET|PATCH /household, GET /household/members
protectedRouter.use(patternsRouter);   // GET /patterns, POST /patterns/:id/*
protectedRouter.use(onboardingRouter); // GET|POST /onboarding/*
protectedRouter.use(googleRouter);     // GET|POST /google/*, DELETE /google/disconnect
protectedRouter.use(briefingRouter);   // POST /briefing/send
protectedRouter.use(adminRouter);      // GET /admin/stats

// Catch-all: any path that reaches here through the protectedRouter did not
// match a registered route. Return 404 so callers get a deterministic error
// rather than Express's default HTML response.
protectedRouter.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

router.use(protectedRouter);

export default router;
