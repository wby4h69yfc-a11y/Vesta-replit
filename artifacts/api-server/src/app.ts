import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { authMiddleware } from "./middlewares/authMiddleware";

const app: Express = express();

// ── CORS ─────────────────────────────────────────────────────────────────────
// Only allow requests from the app's own published domains and the dev preview
// domain. Reflecting origin: true in production would let any site make
// credentialed cross-origin requests using the user's session cookie.
function buildAllowedOrigins(): string[] {
  const origins: string[] = [];
  const domains = process.env.REPLIT_DOMAINS?.split(",").map((d) => d.trim()).filter(Boolean) ?? [];
  for (const d of domains) origins.push(`https://${d}`);
  if (process.env.REPLIT_DEV_DOMAIN) {
    origins.push(`https://${process.env.REPLIT_DEV_DOMAIN}`);
  }
  return origins;
}

const allowedOrigins = buildAllowedOrigins();

app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`));
      }
    },
  }),
);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Session hydration ────────────────────────────────────────────────────────
// Populates req.user and req.isAuthenticated() from the session store.
// This intentionally calls next() for every request (including unauthenticated
// ones) so that public routes (health, auth, webhook) continue to work.
app.use(authMiddleware);

// ── Deny-by-default for /api ─────────────────────────────────────────────────
// Explicit secondary guard: any /api path that is not on the public allow-list
// and is not authenticated is rejected with 401 before it reaches the router.
// This is defence-in-depth on top of the requireAuth middleware that wraps
// every business router in routes/index.ts; the two layers independently
// enforce the same invariant so that a future routing mistake cannot
// accidentally expose a business endpoint without authentication.
const PUBLIC_API_PREFIXES = [
  "/health",
  "/login",
  "/callback",
  "/logout",
  "/auth/",
  "/auth/otp/",
  "/auth/google",
  "/auth/apple",
  "/auth/social/available",
  "/webhook/",
  "/mobile-auth/",
];

app.use("/api", (req: Request, res: Response, next: NextFunction): void => {
  if (req.isAuthenticated()) {
    next();
    return;
  }
  const isPublic = PUBLIC_API_PREFIXES.some(
    (prefix) => req.path === prefix.replace(/\/$/, "") || req.path.startsWith(prefix),
  );
  if (isPublic) {
    next();
    return;
  }
  res.status(401).json({ error: "Unauthorized" });
});

app.use("/api", router);

export default app;
