import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";
import { seedComplianceItems, seedComplianceCompanies } from "./lib/complianceSeed";

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required for signed session cookies.");
}

const app: Express = express();

// Behind Replit's reverse proxy — needed so secure-cookie / protocol detection
// works correctly.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);
// Same-origin in the proxy, but reflect origin + allow credentials so the
// session cookie is accepted in every environment.
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(SESSION_SECRET));

app.use("/api", router);

startScheduler();

// Load the master compliance list on boot (idempotent — only seeds when empty)
// so fresh environments come up populated without a manual migration step.
seedComplianceItems().catch((err) => logger.error({ err }, "Compliance seed failed"));
seedComplianceCompanies().catch((err) => logger.error({ err }, "Compliance company seed failed"));

export default app;
