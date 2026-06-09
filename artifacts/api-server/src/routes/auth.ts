import * as oidc from "openid-client";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  GetCurrentAuthUserResponse,
  ExchangeMobileAuthorizationCodeBody,
  ExchangeMobileAuthorizationCodeResponse,
  LogoutMobileSessionResponse,
} from "@workspace/api-zod";
import { db, usersTable, householdsTable, waOnboardingSessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  clearSession,
  getOidcConfig,
  getSessionId,
  createSession,
  deleteSession,
  SESSION_COOKIE,
  SESSION_TTL,
  ISSUER_URL,
  type SessionData,
} from "../lib/auth";

const OIDC_COOKIE_TTL = 10 * 60 * 1000;

const router: IRouter = Router();

function getOrigin(req: Request): string {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host =
    req.headers["x-forwarded-host"] || req.headers["host"] || "localhost";
  return `${proto}://${host}`;
}

function setSessionCookie(res: Response, sid: string) {
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

function setOidcCookie(res: Response, name: string, value: string) {
  res.cookie(name, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: OIDC_COOKIE_TTL,
  });
}

function getSafeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

async function upsertUser(claims: Record<string, unknown>) {
  const userData = {
    id: claims.sub as string,
    email: (claims.email as string) || null,
    firstName: (claims.first_name as string) || null,
    lastName: (claims.last_name as string) || null,
    profileImageUrl: (claims.profile_image_url || claims.picture) as
      | string
      | null,
  };

  const [user] = await db
    .insert(usersTable)
    .values(userData)
    .onConflictDoUpdate({
      target: usersTable.id,
      set: {
        ...userData,
        updatedAt: new Date(),
      },
    })
    .returning();
  return user;
}

/**
 * Ensures the user has a dedicated household, creating one if needed.
 * Returns the guaranteed non-null household_id.
 */
async function ensureHousehold(userId: string, existingHouseholdId: number | null | undefined): Promise<number> {
  if (existingHouseholdId) return existingHouseholdId;

  const [newHousehold] = await db
    .insert(householdsTable)
    .values({ name: "Minha Casa", plan: "free" })
    .returning();

  await db
    .update(usersTable)
    .set({ household_id: newHousehold.id })
    .where(eq(usersTable.id, userId));

  return newHousehold.id;
}

router.get("/auth/user", (req: Request, res: Response) => {
  res.json(
    GetCurrentAuthUserResponse.parse({
      user: req.isAuthenticated() ? req.user : null,
    }),
  );
});

router.get("/login", async (req: Request, res: Response) => {
  const config = await getOidcConfig();
  const callbackUrl = `${getOrigin(req)}/api/callback`;

  const returnTo = getSafeReturnTo(req.query.returnTo);

  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);

  const redirectTo = oidc.buildAuthorizationUrl(config, {
    redirect_uri: callbackUrl,
    scope: "openid email profile offline_access",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "login consent",
    state,
    nonce,
  });

  setOidcCookie(res, "code_verifier", codeVerifier);
  setOidcCookie(res, "nonce", nonce);
  setOidcCookie(res, "state", state);
  setOidcCookie(res, "return_to", returnTo);

  res.redirect(redirectTo.href);
});

// Query params are not validated because the OIDC provider may include
// parameters not expressed in the schema.
router.get("/callback", async (req: Request, res: Response) => {
  const config = await getOidcConfig();
  const callbackUrl = `${getOrigin(req)}/api/callback`;

  const codeVerifier = req.cookies?.code_verifier;
  const nonce = req.cookies?.nonce;
  const expectedState = req.cookies?.state;

  if (!codeVerifier || !expectedState) {
    res.redirect("/api/login");
    return;
  }

  const currentUrl = new URL(
    `${callbackUrl}?${new URL(req.url, `http://${req.headers.host}`).searchParams}`,
  );

  let tokens: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers;
  try {
    tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: codeVerifier,
      expectedNonce: nonce,
      expectedState,
      idTokenExpected: true,
    });
  } catch {
    res.redirect("/api/login");
    return;
  }

  const returnTo = getSafeReturnTo(req.cookies?.return_to);

  res.clearCookie("code_verifier", { path: "/" });
  res.clearCookie("nonce", { path: "/" });
  res.clearCookie("state", { path: "/" });
  res.clearCookie("return_to", { path: "/" });

  const claims = tokens.claims();
  if (!claims) {
    res.redirect("/api/login");
    return;
  }

  const dbUser = await upsertUser(
    claims as unknown as Record<string, unknown>,
  );

  // Ensure every user has a dedicated household at login time
  const householdId = await ensureHousehold(dbUser.id, dbUser.household_id);

  const now = Math.floor(Date.now() / 1000);
  const sessionData: SessionData = {
    user: {
      id: dbUser.id,
      email: dbUser.email,
      firstName: dbUser.firstName,
      lastName: dbUser.lastName,
      profileImageUrl: dbUser.profileImageUrl,
      household_id: householdId,
    },
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: tokens.expiresIn() ? now + tokens.expiresIn()! : claims.exp,
  };

  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);
  res.redirect(returnTo);
});

router.get("/logout", async (req: Request, res: Response) => {
  const config = await getOidcConfig();
  const origin = getOrigin(req);

  const sid = getSessionId(req);
  await clearSession(res, sid);

  const endSessionUrl = oidc.buildEndSessionUrl(config, {
    client_id: process.env.REPL_ID!,
    post_logout_redirect_uri: origin,
  });

  res.redirect(endSessionUrl.href);
});

router.post(
  "/mobile-auth/token-exchange",
  async (req: Request, res: Response) => {
    const parsed = ExchangeMobileAuthorizationCodeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Missing or invalid required parameters" });
      return;
    }

    const { code, code_verifier, redirect_uri, state, nonce } = parsed.data;

    try {
      const config = await getOidcConfig();

      const callbackUrl = new URL(redirect_uri);
      callbackUrl.searchParams.set("code", code);
      callbackUrl.searchParams.set("state", state);
      callbackUrl.searchParams.set("iss", ISSUER_URL);

      const tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
        pkceCodeVerifier: code_verifier,
        expectedNonce: nonce ?? undefined,
        expectedState: state,
        idTokenExpected: true,
      });

      const claims = tokens.claims();
      if (!claims) {
        res.status(401).json({ error: "No claims in ID token" });
        return;
      }

      const dbUser = await upsertUser(
        claims as unknown as Record<string, unknown>,
      );

      // Ensure every user has a dedicated household at login time
      const householdId = await ensureHousehold(dbUser.id, dbUser.household_id);

      const now = Math.floor(Date.now() / 1000);
      const sessionData: SessionData = {
        user: {
          id: dbUser.id,
          email: dbUser.email,
          firstName: dbUser.firstName,
          lastName: dbUser.lastName,
          profileImageUrl: dbUser.profileImageUrl,
          household_id: householdId,
        },
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expiresIn() ? now + tokens.expiresIn()! : claims.exp,
      };

      const sid = await createSession(sessionData);
      res.json(ExchangeMobileAuthorizationCodeResponse.parse({ token: sid }));
    } catch (err) {
      req.log.error({ err }, "Mobile token exchange error");
      res.status(500).json({ error: "Token exchange failed" });
    }
  },
);

router.post("/mobile-auth/logout", async (req: Request, res: Response) => {
  const sid = getSessionId(req);
  if (sid) {
    await deleteSession(sid);
  }
  res.json(LogoutMobileSessionResponse.parse({ success: true }));
});

/**
 * POST /api/auth/claim-magic
 *
 * Public endpoint — no session required.
 * Exchanges a one-time magic token (sent via WhatsApp at the end of the
 * WA-native onboarding flow) for a full web session cookie.
 *
 * Security guarantees:
 *   - Token is single-use: cleared after a short grace window.
 *   - Token expires 30 minutes after creation (set by wa-onboarding-handler).
 *   - Returns 404 for unknown tokens (same as expired — no timing oracle).
 *   - Grace window (10 s): if the same token is claimed a second time within
 *     10 seconds of the first claim (e.g. double-tap or two-tab scenario) the
 *     server creates a fresh session for the same user and returns 200, so the
 *     user lands in the app instead of seeing a login error.
 *   - After the grace window the token row is invalidated (magic_token → null).
 */

/** Milliseconds a claimed token stays alive for duplicate-claim recovery. */
const MAGIC_CLAIM_GRACE_MS = 10_000;

router.post("/auth/claim-magic", async (req: Request, res: Response) => {
  const { token } = req.body as { token?: string };
  if (!token || typeof token !== "string") {
    res.status(400).json({ error: "Token required" });
    return;
  }

  try {
    const [session] = await db
      .select()
      .from(waOnboardingSessionsTable)
      .where(eq(waOnboardingSessionsTable.magic_token, token.trim()))
      .limit(1);

    if (
      !session ||
      !session.created_user_id ||
      !session.magic_token_expires_at ||
      session.magic_token_expires_at < new Date()
    ) {
      res.status(404).json({ error: "Token not found or expired" });
      return;
    }

    const now = new Date();

    // --- Grace-window: token was already claimed but we are within the window ---
    if (session.magic_token_claimed_at !== null) {
      const ageMs = now.getTime() - session.magic_token_claimed_at.getTime();
      if (ageMs <= MAGIC_CLAIM_GRACE_MS) {
        // Duplicate claim within grace window — issue another session for the
        // same user so both tabs/taps land in the app.
        req.log.info(
          { phone: session.phone, ageMs },
          "WA magic-link duplicate claim within grace window — issuing extra session",
        );
      } else {
        // Grace window expired — treat as an already-used token.
        res.status(404).json({ error: "Token not found or expired" });
        return;
      }
    } else {
      // --- First claim: stamp claimed_at and schedule token invalidation ---
      await db
        .update(waOnboardingSessionsTable)
        .set({ magic_token_claimed_at: now })
        .where(eq(waOnboardingSessionsTable.id, session.id));

      // Invalidate the token row after the grace window so subsequent attempts
      // beyond the window get a 404. We run this in a non-blocking setTimeout
      // so the current request completes immediately.
      setTimeout(() => {
        db.update(waOnboardingSessionsTable)
          .set({ magic_token: null, magic_token_expires_at: null, magic_token_claimed_at: null })
          .where(eq(waOnboardingSessionsTable.id, session.id))
          .catch(() => {
            // Best-effort: token row will eventually expire via magic_token_expires_at
          });
      }, MAGIC_CLAIM_GRACE_MS);
    }

    // Load the user that was created during WA onboarding
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, session.created_user_id))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const sessionData: SessionData = {
      user: {
        id: user.id,
        email: user.email ?? null,
        phone: user.phone ?? null,
        firstName: user.firstName ?? null,
        lastName: user.lastName ?? null,
        profileImageUrl: user.profileImageUrl ?? null,
        household_id: user.household_id ?? null,
      },
      access_token: "",
    };

    const sid = await createSession(sessionData);

    res.cookie(SESSION_COOKIE, sid, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_TTL,
      path: "/",
    });

    req.log.info({ userId: user.id, phone: session.phone }, "WA magic-link claimed — web session created");

    res.json({ success: true, user: sessionData.user });
  } catch (err) {
    req.log.error({ err }, "Failed to claim magic link");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
