import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dashboardRouter from "./dashboard";
import inboxRouter from "./inbox";
import actionsRouter from "./actions";
import tasksRouter from "./tasks";
import eventsRouter from "./events";
import contactsRouter from "./contacts";
import rulesRouter from "./rules";
import householdRouter from "./household";
import patternsRouter from "./patterns";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dashboardRouter);
router.use(inboxRouter);
router.use(actionsRouter);
router.use(tasksRouter);
router.use(eventsRouter);
router.use(contactsRouter);
router.use(rulesRouter);
router.use(householdRouter);
router.use(patternsRouter);

export default router;
