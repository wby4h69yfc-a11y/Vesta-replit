import { Router, type IRouter } from "express";
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

const router: IRouter = Router();

// ── Public routes (no auth required) ──────────────────────────────────────────
router.use(healthRouter);
router.use(authRouter);
router.use(authOtpRouter);
router.use(authSocialRouter);
router.use(webhookRouter);

// ── Protected routes (session required + household assigned) ───────────────────
// requireAuth: returns 401 for unauthenticated requests
// requireHousehold: returns 409 for authenticated users without a household
const protectedRouter: IRouter = Router();
protectedRouter.use(requireAuth);
protectedRouter.use(requireHousehold);
protectedRouter.use(dashboardRouter);
protectedRouter.use(inboxRouter);
protectedRouter.use(actionsRouter);
protectedRouter.use(tasksRouter);
protectedRouter.use(eventsRouter);
protectedRouter.use(contactsRouter);
protectedRouter.use(rulesRouter);
protectedRouter.use(householdRouter);
protectedRouter.use(patternsRouter);
protectedRouter.use(onboardingRouter);
protectedRouter.use(googleRouter);
protectedRouter.use(briefingRouter);

router.use(protectedRouter);

export default router;
