import type { Request, Response, NextFunction } from "express";

/**
 * Builds the list of origins that are considered "same-site" for this server.
 * Mirrors the logic in app.ts CORS config so both layers stay in sync.
 */
function buildAllowedOrigins(): string[] {
  const origins: string[] = [];
  const domains =
    process.env.REPLIT_DOMAINS?.split(",")
      .map((d) => d.trim())
      .filter(Boolean) ?? [];
  for (const d of domains) origins.push(`https://${d}`);
  if (process.env.REPLIT_DEV_DOMAIN) {
    origins.push(`https://${process.env.REPLIT_DEV_DOMAIN}`);
  }
  return origins;
}

/**
 * requireSameOrigin — middleware that rejects cross-origin POST/PUT/PATCH/DELETE
 * requests whose Origin header does not match an allowed origin.
 *
 * Use on any endpoint that mints or destroys sessions (login, logout, magic-link
 * claim, etc.) to prevent login-CSRF and logout-CSRF attacks. Note that sameSite
 * cookies alone do not protect session-minting endpoints — the cookie is being
 * SET, not read, so the browser will accept it regardless of sameSite.
 *
 * Rules:
 *   - No Origin header → allow (same-origin navigation, server-to-server).
 *   - Origin matches allowedOrigins → allow.
 *   - Dev only: localhost origins → allow (Playwright / local dev).
 *   - Dev only (no configured origins): allow all (dev convenience).
 *   - Otherwise → 403.
 */
export function requireSameOrigin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const origin = req.headers["origin"];

  // No Origin header — same-origin browser request or server-to-server call.
  if (!origin) {
    next();
    return;
  }

  const allowedOrigins = buildAllowedOrigins();
  const isProduction = process.env.NODE_ENV === "production";

  // In development with no configured origins: allow all (dev convenience).
  if (!isProduction && allowedOrigins.length === 0) {
    next();
    return;
  }

  // Allow localhost in development (Playwright / local browser testing).
  if (!isProduction && /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
    next();
    return;
  }

  if (allowedOrigins.includes(origin)) {
    next();
    return;
  }

  res.status(403).json({ error: "Forbidden: cross-origin request rejected" });
}
