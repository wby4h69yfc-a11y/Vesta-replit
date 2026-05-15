import crypto from "crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { google } from "googleapis";
import jwt from "jsonwebtoken";
import { db, usersTable } from "@workspace/db";
import { eq, or } from "drizzle-orm";
import {
  createSession,
  getSessionId,
  SESSION_COOKIE,
  SESSION_TTL,
} from "../lib/auth";

const router: IRouter = Router();

const NONCE_COOKIE = "oauth_nonce";
const NONCE_TTL = 5 * 60 * 1000; // 5 min

// ── helpers ───────────────────────────────────────────────────────────────────

function getBaseUrl(): string {
  const domains = process.env.REPLIT_DOMAINS?.split(",")[0];
  const dev = process.env.REPLIT_DEV_DOMAIN;
  const host = domains ?? dev;
  return host ? `https://${host}` : "http://localhost:8080";
}

function getGoogleOAuth2() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    `${getBaseUrl()}/api/auth/google/callback`,
  );
}

function setNonceCookie(res: Response, nonce: string) {
  res.cookie(NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: NONCE_TTL,
  });
}

function clearNonceCookie(res: Response) {
  res.clearCookie(NONCE_COOKIE, { path: "/" });
}

// ── Google Sign-In ────────────────────────────────────────────────────────────

router.get("/auth/google", (_req: Request, res: Response) => {
  const nonce = crypto.randomBytes(16).toString("hex");
  setNonceCookie(res, nonce);

  const oauth2 = getGoogleOAuth2();
  const url = oauth2.generateAuthUrl({
    access_type: "online",
    scope: ["openid", "email", "profile"],
    state: nonce,
  });

  res.redirect(url);
});

router.get("/auth/google/callback", async (req: Request, res: Response) => {
  const { code, state, error } = req.query as Record<string, string>;
  clearNonceCookie(res);

  if (error) {
    res.redirect("/login?error=google_denied");
    return;
  }

  const storedNonce = req.cookies?.[NONCE_COOKIE] as string | undefined;
  if (!storedNonce || storedNonce !== state) {
    res.redirect("/login?error=invalid_state");
    return;
  }

  const oauth2 = getGoogleOAuth2();
  let accessToken: string;
  let googleUserId: string;
  let googleEmail: string | null | undefined;
  let firstName: string | null | undefined;
  let lastName: string | null | undefined;
  let picture: string | null | undefined;

  try {
    const { tokens } = await oauth2.getToken(code);
    if (!tokens.access_token) throw new Error("No access token");
    oauth2.setCredentials(tokens);
    accessToken = tokens.access_token;

    const oauth2api = google.oauth2({ version: "v2", auth: oauth2 });
    const { data } = await oauth2api.userinfo.get();

    if (!data.id) throw new Error("No Google user ID");
    googleUserId = data.id;
    googleEmail = data.email;
    firstName = data.given_name;
    lastName = data.family_name;
    picture = data.picture;
  } catch (err) {
    req.log.error({ err }, "Google sign-in failed");
    res.redirect("/login?error=google_failed");
    return;
  }

  // Find by google_id, then by email, else create
  const conditions = [eq(usersTable.googleId, googleUserId)];
  if (googleEmail) conditions.push(eq(usersTable.email, googleEmail));

  const [existing] = await db
    .select()
    .from(usersTable)
    .where(or(...conditions))
    .limit(1);

  let userId: string;
  let userEmail: string | null;
  let userFirst: string | null;
  let userLast: string | null;
  let userPic: string | null;

  if (existing) {
    userId = existing.id;
    userEmail = existing.email ?? googleEmail ?? null;
    userFirst = existing.firstName ?? firstName ?? null;
    userLast = existing.lastName ?? lastName ?? null;
    userPic = existing.profileImageUrl ?? picture ?? null;
    if (!existing.googleId) {
      await db
        .update(usersTable)
        .set({ googleId: googleUserId })
        .where(eq(usersTable.id, userId));
    }
  } else {
    const [created] = await db
      .insert(usersTable)
      .values({
        email: googleEmail ?? null,
        firstName: firstName ?? null,
        lastName: lastName ?? null,
        profileImageUrl: picture ?? null,
        googleId: googleUserId,
      })
      .returning();
    userId = created.id;
    userEmail = created.email ?? null;
    userFirst = created.firstName ?? null;
    userLast = created.lastName ?? null;
    userPic = created.profileImageUrl ?? null;
  }

  const sid = await createSession({
    user: {
      id: userId,
      email: userEmail,
      phone: null,
      firstName: userFirst,
      lastName: userLast,
      profileImageUrl: userPic,
      google_connected: false,
    },
    access_token: accessToken,
  });

  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL,
  });

  res.redirect("/app");
});

// ── Apple Sign-In ─────────────────────────────────────────────────────────────

function appleConfigured(): boolean {
  return !!(
    process.env.APPLE_CLIENT_ID &&
    process.env.APPLE_TEAM_ID &&
    process.env.APPLE_KEY_ID &&
    process.env.APPLE_PRIVATE_KEY
  );
}

function generateAppleClientSecret(): string {
  const privateKey = process.env.APPLE_PRIVATE_KEY!.replace(/\\n/g, "\n");
  return jwt.sign({}, privateKey, {
    algorithm: "ES256",
    expiresIn: "5m",
    audience: "https://appleid.apple.com",
    issuer: process.env.APPLE_TEAM_ID,
    subject: process.env.APPLE_CLIENT_ID,
    keyid: process.env.APPLE_KEY_ID,
  });
}

router.get("/auth/apple", (req: Request, res: Response) => {
  if (!appleConfigured()) {
    res.redirect("/login?error=apple_not_configured");
    return;
  }

  const nonce = crypto.randomBytes(16).toString("hex");
  setNonceCookie(res, nonce);

  const params = new URLSearchParams({
    client_id: process.env.APPLE_CLIENT_ID!,
    redirect_uri: `${getBaseUrl()}/api/auth/apple/callback`,
    response_type: "code",
    scope: "name email",
    response_mode: "form_post",
    state: nonce,
  });

  res.redirect(`https://appleid.apple.com/auth/authorize?${params.toString()}`);
});

// Apple sends a POST with form data
router.post("/auth/apple/callback", async (req: Request, res: Response) => {
  if (!appleConfigured()) {
    res.redirect("/login?error=apple_not_configured");
    return;
  }

  clearNonceCookie(res);

  const { code, state, error, user: userJson } = req.body as Record<string, string>;

  if (error) {
    res.redirect("/login?error=apple_denied");
    return;
  }

  const storedNonce = req.cookies?.[NONCE_COOKIE] as string | undefined;
  if (!storedNonce || storedNonce !== state) {
    res.redirect("/login?error=invalid_state");
    return;
  }

  // Exchange code for tokens
  let idToken: string;
  try {
    const clientSecret = generateAppleClientSecret();
    const tokenRes = await fetch("https://appleid.apple.com/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.APPLE_CLIENT_ID!,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: `${getBaseUrl()}/api/auth/apple/callback`,
      }),
    });
    const tokenData = await tokenRes.json() as { id_token?: string; error?: string };
    if (!tokenData.id_token) throw new Error(tokenData.error ?? "No id_token");
    idToken = tokenData.id_token;
  } catch (err) {
    req.log.error({ err }, "Apple token exchange failed");
    res.redirect("/login?error=apple_failed");
    return;
  }

  // Decode id_token (Apple's public keys would be needed for full verification;
  // for now we decode without verifying signature — production should verify)
  let appleUserId: string;
  let appleEmail: string | null = null;
  try {
    const decoded = jwt.decode(idToken) as { sub?: string; email?: string } | null;
    if (!decoded?.sub) throw new Error("No sub in id_token");
    appleUserId = decoded.sub;
    appleEmail = decoded.email ?? null;
  } catch (err) {
    req.log.error({ err }, "Apple id_token decode failed");
    res.redirect("/login?error=apple_failed");
    return;
  }

  // Apple sends name only on first sign-in via the user field in form body
  let firstName: string | null = null;
  let lastName: string | null = null;
  if (userJson) {
    try {
      const appleUser = JSON.parse(userJson) as { name?: { firstName?: string; lastName?: string } };
      firstName = appleUser.name?.firstName ?? null;
      lastName = appleUser.name?.lastName ?? null;
    } catch {
      // ignored
    }
  }

  // Find by apple_id, then email, else create
  const conditions = [eq(usersTable.appleId, appleUserId)];
  if (appleEmail) conditions.push(eq(usersTable.email, appleEmail));

  const [existing] = await db
    .select()
    .from(usersTable)
    .where(or(...conditions))
    .limit(1);

  let userId: string;
  let userEmail: string | null;
  let userFirst: string | null;
  let userLast: string | null;

  if (existing) {
    userId = existing.id;
    userEmail = existing.email ?? appleEmail ?? null;
    userFirst = existing.firstName ?? firstName ?? null;
    userLast = existing.lastName ?? lastName ?? null;
    if (!existing.appleId) {
      await db
        .update(usersTable)
        .set({ appleId: appleUserId })
        .where(eq(usersTable.id, userId));
    }
  } else {
    const [created] = await db
      .insert(usersTable)
      .values({
        email: appleEmail ?? null,
        firstName: firstName ?? null,
        lastName: lastName ?? null,
        appleId: appleUserId,
      })
      .returning();
    userId = created.id;
    userEmail = created.email ?? null;
    userFirst = created.firstName ?? null;
    userLast = created.lastName ?? null;
  }

  const sid = await createSession({
    user: {
      id: userId,
      email: userEmail,
      phone: null,
      firstName: userFirst,
      lastName: userLast,
      profileImageUrl: null,
      google_connected: false,
    },
    access_token: "",
  });

  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL,
  });

  res.redirect("/app");
});

// Tell the frontend which social providers are available
router.get("/auth/social/available", (_req: Request, res: Response) => {
  res.json({
    google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    apple: appleConfigured(),
  });
});

export default router;
