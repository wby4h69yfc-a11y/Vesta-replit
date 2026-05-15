import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import dashboardRouter from "./dashboard";
import inboxRouter from "./inbox";
import actionsRouter from "./actions";
import tasksRouter from "./tasks";
import eventsRouter from "./events";
import contactsRouter from "./contacts";
import rulesRouter from "./rules";
import householdRouter from "./household";
import patternsRouter from "./patterns";
import webhookRouter from "./webhook";
import onboardingRouter from "./onboarding";
import authOtpRouter from "./auth-otp";
import googleRouter from "./google";
import authSocialRouter from "./auth-social";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(dashboardRouter);
router.use(inboxRouter);
router.use(actionsRouter);
router.use(tasksRouter);
router.use(eventsRouter);
router.use(contactsRouter);
router.use(rulesRouter);
router.use(householdRouter);
router.use(patternsRouter);
router.use(webhookRouter);
router.use(onboardingRouter);
router.use(authOtpRouter);
router.use(googleRouter);
router.use(authSocialRouter);

export default router;
