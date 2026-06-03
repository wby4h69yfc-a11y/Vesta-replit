import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { authMiddleware } from "./middlewares/authMiddleware";

const app: Express = express();

// Trust Replit's reverse proxy so req.ip resolves to the real client IP
// (read from X-Forwarded-For) rather than the shared proxy address.
// Without this, all OTP rate-limit buckets collapse to one proxy IP and
// any single user can exhaust the shared limit for every other user.
app.set("trust proxy", 1);

// ── CORS ─────────────────────────────────────────────────────────────────────
// Only allow requests from the app's own published domains and the dev preview
// domain. Reflecting origin: true would let any site make credentialed
// cross-origin requests using the user's session cookie.
//
// In production: if no allowed origins are configured (empty REPLIT_DOMAINS and
// no REPLIT_DEV_DOMAIN) all cross-origin requests are denied — fail closed.
// In development: if neither env var is set, all origins are permitted so local
// browser testing works without additional config.
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
const isProduction = process.env.NODE_ENV === "production";

if (isProduction && allowedOrigins.length === 0) {
  logger.error(
    "CORS misconfiguration: REPLIT_DOMAINS and REPLIT_DEV_DOMAIN are both unset in production. " +
    "All cross-origin requests will be denied.",
  );
}

app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      // Server-to-server or same-origin requests have no Origin header — allow.
      if (!origin) {
        callback(null, true);
        return;
      }
      // In production with no configured origins: deny all cross-origin requests.
      if (isProduction && allowedOrigins.length === 0) {
        callback(new Error(`CORS: no allowed origins configured in production`));
        return;
      }
      // In development, also allow localhost origins (used by Playwright E2E tests).
      const isLocalhost = !isProduction && /^https?:\/\/localhost(:\d+)?$/.test(origin);
      // In development with no configured origins: allow all (dev convenience).
      if (allowedOrigins.length === 0 || allowedOrigins.includes(origin) || isLocalhost) {
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
// Calls next() for every request so public routes remain accessible.
app.use(authMiddleware);

// ── Deny-by-default for /api ─────────────────────────────────────────────────
// Explicit secondary guard: any /api path that is not on the public allow-list
// and is not authenticated is rejected with 401 before reaching the router.
// This is defence-in-depth on top of the requireAuth middleware that wraps
// every business router in routes/index.ts; the two layers enforce the same
// invariant independently so that a future routing mistake cannot accidentally
// expose a business endpoint without authentication.
//
// This list enumerates EXACT public paths (and prefix matches only where a
// family of paths must all be public, e.g. /auth/google/callback). Adding new
// business handlers under these prefixes would still require an authenticated
// session to do anything useful — but prefer explicit paths over broad prefixes
// when adding new public endpoints to minimise the attack surface.
const PUBLIC_API_EXACT: ReadonlySet<string> = new Set([
  "/healthz",
  "/auth/user",
  "/login",
  "/callback",
  "/logout",
  "/auth/otp/send",
  "/auth/otp/verify",
  "/auth/google",
  "/auth/google/callback",
  "/auth/apple",
  "/auth/apple/callback",
  "/auth/social/available",
  "/webhook/whatsapp",
  "/webhook/whatsapp/info",
  "/mobile-auth/token-exchange",
  "/mobile-auth/logout",
  "/dev/test-login",
]);

app.use("/api", (req: Request, res: Response, next: NextFunction): void => {
  if (req.isAuthenticated()) {
    next();
    return;
  }
  if (PUBLIC_API_EXACT.has(req.path)) {
    next();
    return;
  }
  res.status(401).json({ error: "Unauthorized" });
});

app.use("/api", router);

export default app;
