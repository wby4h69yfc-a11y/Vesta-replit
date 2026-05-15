import crypto from "crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, gt, isNull } from "drizzle-orm";
import { db, otpCodesTable, usersTable, householdsTable } from "@workspace/db";
import {
  createSession,
  SESSION_COOKIE,
  SESSION_TTL,
  type SessionData,
} from "../lib/auth";
import { sendWhatsApp, isTwilioConfigured } from "../lib/whatsapp";

const router: IRouter = Router();

// ── Constants ──────────────────────────────────────────────────────────────────

/** Maximum failed verify attempts before the OTP is invalidated. */
const MAX_VERIFY_ATTEMPTS = 5;

/** Max OTP sends per phone per window. */
const SEND_PHONE_MAX = 3;
/** Max OTP sends per IP per window. */
const SEND_IP_MAX = 10;
/** Window length in ms for send rate limiting. */
const SEND_WINDOW_MS = 10 * 60 * 1_000; // 10 minutes

// ── In-memory rate limiter ────────────────────────────────────────────────────
//
// Tracks send attempts in a Map keyed by "phone:<number>" or "ip:<address>".
// Entries are pruned on every check, so memory stays bounded under normal load.
// For horizontally-scaled deployments a Redis-backed counter is preferable, but
// this is sufficient for a single-process server and far better than nothing.

interface RateBucket {
  count: number;
  resetAt: number;
}

const sendBuckets = new Map<string, RateBucket>();

function checkSendRateLimit(key: string, max: number): boolean {
  const now = Date.now();
  const bucket = sendBuckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    sendBuckets.set(key, { count: 1, resetAt: now + SEND_WINDOW_MS });
    return true; // allowed
  }

  if (bucket.count >= max) {
    return false; // denied
  }

  bucket.count++;
  return true; // allowed
}

/** Periodic cleanup — remove expired buckets to avoid unbounded growth. */
setInterval(
  () => {
    const now = Date.now();
    for (const [key, bucket] of sendBuckets) {
      if (now >= bucket.resetAt) sendBuckets.delete(key);
    }
  },
  SEND_WINDOW_MS,
).unref();

// ── Helpers ────────────────────────────────────────────────────────────────────

function generateOtp(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length >= 12) return `+${digits}`;
  if (digits.length >= 10) return `+55${digits}`;
  return `+${digits}`;
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

async function sendWhatsAppOtp(
  req: Request,
  phone: string,
  code: string,
): Promise<void> {
  const body = `Seu código Vesta: *${code}*\n\nVálido por 10 minutos. Não compartilhe com ninguém.`;

  if (!isTwilioConfigured()) {
    req.log.info({ phone, code }, "[OTP DEV] WhatsApp OTP — Twilio not configured");
    return;
  }

  const result = await sendWhatsApp(phone, body);
  if (!result.ok) {
    throw new Error(result.error);
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * POST /api/auth/otp/send
 *
 * Issues a fresh six-digit OTP for the supplied phone number via WhatsApp.
 *
 * Rate limits (per 10-minute window):
 *   - 3 sends per unique phone number
 *   - 10 sends per originating IP address
 *
 * A new code always invalidates any previous unused code for the same number.
 */
router.post("/auth/otp/send", async (req: Request, res: Response) => {
  const { phone: rawPhone } = req.body as { phone?: unknown };

  if (!rawPhone || typeof rawPhone !== "string" || rawPhone.trim().length < 8) {
    res.status(400).json({ error: "Número de telefone inválido" });
    return;
  }

  const phone = normalizePhone(rawPhone.trim());
  const ip = req.ip ?? "unknown";

  // ── Rate limiting ────────────────────────────────────────────────────────
  const phoneAllowed = checkSendRateLimit(`phone:${phone}`, SEND_PHONE_MAX);
  const ipAllowed = checkSendRateLimit(`ip:${ip}`, SEND_IP_MAX);

  if (!phoneAllowed || !ipAllowed) {
    req.log.warn({ phone, ip }, "OTP send rate limit exceeded");
    res.status(429).json({
      error: "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.",
    });
    return;
  }

  // Delete any previous unused codes for this number
  await db
    .delete(otpCodesTable)
    .where(
      and(eq(otpCodesTable.phone, phone), isNull(otpCodesTable.used_at)),
    );

  const code = generateOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1_000);

  await db.insert(otpCodesTable).values({ phone, code, expires_at: expiresAt });

  try {
    await sendWhatsAppOtp(req, phone, code);
  } catch (err) {
    req.log.error({ err }, "WhatsApp OTP send failed");
    res.status(500).json({
      error:
        "Falha ao enviar o código. Verifique o número e tente novamente.",
    });
    return;
  }

  res.json({ sent: true, message: `Código enviado para ${phone}` });
});

/**
 * POST /api/auth/otp/verify
 *
 * Verifies a six-digit OTP for the supplied phone number.
 *
 * Security guarantees:
 *   - Each wrong guess increments `failed_attempts` on the OTP row.
 *   - After MAX_VERIFY_ATTEMPTS (5) failures the code is invalidated by
 *     setting `used_at` immediately, forcing the user to request a new one.
 *   - This caps the online search space to 5 attempts instead of 1 000 000.
 */
router.post("/auth/otp/verify", async (req: Request, res: Response) => {
  const { phone: rawPhone, code } = req.body as {
    phone?: unknown;
    code?: unknown;
  };

  if (
    !rawPhone ||
    typeof rawPhone !== "string" ||
    !code ||
    typeof code !== "string"
  ) {
    res.status(400).json({ error: "Telefone e código são obrigatórios" });
    return;
  }

  const phone = normalizePhone(rawPhone.trim());
  const now = new Date();

  // Fetch the active (unused, unexpired) OTP for this phone number.
  // We do NOT filter by code yet — we need the row to increment failed_attempts.
  const [otp] = await db
    .select()
    .from(otpCodesTable)
    .where(
      and(
        eq(otpCodesTable.phone, phone),
        gt(otpCodesTable.expires_at, now),
        isNull(otpCodesTable.used_at),
      ),
    )
    .limit(1);

  // Generic error message — don't reveal whether the phone has an active code.
  const invalidMsg = "Código inválido ou expirado";

  if (!otp) {
    res.status(400).json({ error: invalidMsg });
    return;
  }

  // Check whether this OTP has already exceeded the attempt cap (belt-and-suspenders
  // guard in case a concurrent request slipped through).
  if (otp.failed_attempts >= MAX_VERIFY_ATTEMPTS) {
    req.log.warn({ phone }, "OTP verify: attempt cap already reached");
    res.status(400).json({ error: invalidMsg });
    return;
  }

  // Constant-time comparison to prevent timing attacks.
  const codeBuffer = Buffer.from(code.trim().padEnd(6));
  const otpBuffer = Buffer.from(otp.code.padEnd(6));
  const codeMatches =
    codeBuffer.length === otpBuffer.length &&
    crypto.timingSafeEqual(codeBuffer, otpBuffer);

  if (!codeMatches) {
    const newAttempts = otp.failed_attempts + 1;
    const shouldInvalidate = newAttempts >= MAX_VERIFY_ATTEMPTS;

    await db
      .update(otpCodesTable)
      .set({
        failed_attempts: newAttempts,
        // Invalidate by marking used_at so no further guesses are possible.
        ...(shouldInvalidate ? { used_at: now } : {}),
      })
      .where(eq(otpCodesTable.id, otp.id));

    req.log.warn(
      { phone, attempts: newAttempts, invalidated: shouldInvalidate },
      "OTP verify: wrong code",
    );

    res.status(400).json({ error: invalidMsg });
    return;
  }

  // Correct code — mark as used.
  await db
    .update(otpCodesTable)
    .set({ used_at: now })
    .where(eq(otpCodesTable.id, otp.id));

  // Upsert user by phone — creates a new account on first login
  let [user] = await db
    .insert(usersTable)
    .values({ phone })
    .onConflictDoUpdate({
      target: usersTable.phone,
      set: { updatedAt: new Date() },
    })
    .returning();

  // Ensure every user has a dedicated household at login time.
  // This guarantees household isolation from the very first session.
  let householdId = user.household_id;
  if (!householdId) {
    const [newHousehold] = await db
      .insert(householdsTable)
      .values({ name: "Minha Casa", plan: "free" })
      .returning();
    householdId = newHousehold.id;
    const [updated] = await db
      .update(usersTable)
      .set({ household_id: householdId })
      .where(eq(usersTable.id, user.id))
      .returning();
    user = updated;
  }

  const sessionData: SessionData = {
    user: {
      id: user.id,
      email: user.email ?? null,
      phone: user.phone ?? null,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      profileImageUrl: user.profileImageUrl ?? null,
      household_id: householdId,
    },
    access_token: "",
  };

  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);

  res.json({ success: true, user: sessionData.user });
});

export default router;
