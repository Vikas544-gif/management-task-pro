import { Router, type IRouter } from "express";
import healthRouter from "./health";
import usersRouter from "./users";
import authRouter from "./auth";
import tasksRouter from "./tasks";
import categoriesRouter from "./categories";
import emailRouter from "./email";
import cronRouter from "./cron";
import reportsRouter from "./reports";
import notificationsRouter from "./notifications";
import attendanceRouter from "./attendance";
import agentMetricsRouter from "./agentMetrics";
import eodRouter from "./eod";
import salesMtdRouter from "./salesMtd";
import complianceRouter from "./compliance";
import holidaysRouter from "./holidays";
import salesDashboardRouter from "./salesDashboard";
import pushRouter from "./push";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

// Public: health check + auth (login/logout are public; /auth/me self-gates).
router.use(healthRouter);
router.use("/auth", authRouter);
// Public but secret-token protected: external scheduler trigger for daily emails.
router.use("/cron", cronRouter);
// Public: one-way read-only feed for the standalone Sales Performance Dashboard.
router.use("/sales-dashboard", salesDashboardRouter);

// Everything below requires a valid session.
router.use(requireAuth);

router.use("/users", usersRouter);
router.use("/tasks", tasksRouter);
router.use("/categories", categoriesRouter);
router.use("/email", emailRouter);
router.use("/reports", reportsRouter);
router.use("/notifications", notificationsRouter);
router.use("/attendance", attendanceRouter);
router.use("/agent-metrics", agentMetricsRouter);
router.use("/eod", eodRouter);
router.use("/sales-mtd", salesMtdRouter);
router.use("/compliance", complianceRouter);
router.use("/holidays", holidaysRouter);
router.use("/push", pushRouter);

export default router;
