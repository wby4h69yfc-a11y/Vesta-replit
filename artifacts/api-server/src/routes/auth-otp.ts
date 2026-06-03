import crypto from "crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, gt, isNull, sql } from "drizzle-orm";
import { db, otpCodesTable, otpRateLimitsTable, usersTable, householdsTable } from "@workspace/db";
import {
  createSession,
  SESSION_COOKIE,
  SESSION_TTL,
  type SessionData,
} from "../lib/auth";
import { sendWhatsApp, isTwilioConfigured } from "../lib/whatsapp";

const router: IRouter = Router();

const MAX_VERIFY_ATTEMPTS = 5;

const SEND_PHONE_MAX = 3;
const SEND_IP_MAX = 10;
const VERIFY_PHONE_MAX = 10;
const VERIFY_IP_MAX = 20;

/**
 * DB-backed rate limiter — works correctly across all autoscaled instances.
 *
 * A single atomic INSERT … ON CONFLICT DO UPDATE:
 *  - Inserts a new bucket (count=1) on the first request in a window.
 *  - On conflict, resets to count=1 when the 10-minute window has elapsed,
 *    or increments the existing counter otherwise.
 * The RETURNING clause lets us check the post-update count without a
 * second round-trip. There is no TOCTOU gap.
 *
 * Returns true when the caller is within the allowed limit, false when
 * the limit has been exceeded (caller should respond 429).
 */
async function checkRateLimit(key: string, max: number): Promise<boolean> {
  const [result] = await db
    .insert(otpRateLimitsTable)
    .values({ key, count: 1, window_start: new Date() })
    .onConflictDoUpdate({
      target: otpRateLimitsTable.key,
      set: {
        count: sql`CASE WHEN ${otpRateLimitsTable.window_start} < NOW() - INTERVAL '10 minutes' THEN 1 ELSE ${otpRateLimitsTable.count} + 1 END`,
        window_start: sql`CASE WHEN ${otpRateLimitsTable.window_start} < NOW() - INTERVAL '10 minutes' THEN NOW() ELSE ${otpRateLimitsTable.window_start} END`,
      },
    })
    .returning({ count: otpRateLimitsTable.count });

  return (result?.count ?? 1) <= max;
}

function generateOtp(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  // Client sends full E.164 (e.g. "+5511999999999") — strip whitespace/formatting only
  if (trimmed.startsWith("+")) {
    return "+" + trimmed.replace(/\D/g, "");
  }
  // Bare digits fallback (backwards compatibility): assume Brazilian number
  const digits = trimmed.replace(/\D/g, "");
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

/**
 * POST /api/auth/otp/send
 *
 * Rate limits per 10-minute window:
 *   - 3 sends per phone number
 *   - 10 sends per IP address
 */
router.post("/auth/otp/send", async (req: Request, res: Response) => {
  const { phone: rawPhone } = req.body as { phone?: unknown };

  if (!rawPhone || typeof rawPhone !== "string" || rawPhone.trim().length < 8) {
    res.status(400).json({ error: "Número de telefone inválido" });
    return;
  }

  const phone = normalizePhone(rawPhone.trim());
  const ip = req.ip ?? "unknown";

  if (
    !(await checkRateLimit(`send:phone:${phone}`, SEND_PHONE_MAX)) ||
    !(await checkRateLimit(`send:ip:${ip}`, SEND_IP_MAX))
  ) {
    req.log.warn({ phone, ip }, "OTP send rate limit exceeded");
    res.status(429).json({
      error: "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.",
    });
    return;
  }

  await db
    .delete(otpCodesTable)
    .where(and(eq(otpCodesTable.phone, phone), isNull(otpCodesTable.used_at)));

  const code = generateOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1_000);

  await db.insert(otpCodesTable).values({ phone, code, expires_at: expiresAt });

  try {
    await sendWhatsAppOtp(req, phone, code);
  } catch (err) {
    req.log.error({ err }, "WhatsApp OTP send failed");
    res.status(500).json({
      error: "Falha ao enviar o código. Verifique o número e tente novamente.",
    });
    return;
  }

  res.json({ sent: true, message: `Código enviado para ${phone}` });
});

/**
 * POST /api/auth/otp/verify
 *
 * Rate limits per 10-minute window:
 *   - 10 verify attempts per phone number
 *   - 20 verify attempts per IP address
 *
 * Failed attempts are also tracked on the OTP row itself: after
 * MAX_VERIFY_ATTEMPTS (5) wrong guesses the code is atomically invalidated
 * (used_at set) so no further guesses are accepted. The attempt increment
 * is performed as a single atomic SQL UPDATE so concurrent requests cannot
 * race past the cap.
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
  const ip = req.ip ?? "unknown";

  // Time-window rate limiting on verify (independent of per-OTP attempt cap)
  if (
    !(await checkRateLimit(`verify:phone:${phone}`, VERIFY_PHONE_MAX)) ||
    !(await checkRateLimit(`verify:ip:${ip}`, VERIFY_IP_MAX))
  ) {
    req.log.warn({ phone, ip }, "OTP verify rate limit exceeded");
    res.status(429).json({
      error: "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.",
    });
    return;
  }

  const now = new Date();
  const invalidMsg = "Código inválido ou expirado";

  // Fetch the active (unused, unexpired, under-cap) OTP for this phone.
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

  if (!otp) {
    res.status(400).json({ error: invalidMsg });
    return;
  }

  // Constant-time comparison to prevent timing side-channels.
  const codeBuffer = Buffer.from(code.trim().padEnd(6));
  const otpBuffer = Buffer.from(otp.code.padEnd(6));
  const codeMatches =
    codeBuffer.length === otpBuffer.length &&
    crypto.timingSafeEqual(codeBuffer, otpBuffer);

  if (!codeMatches) {
    // Atomically increment failed_attempts and conditionally set used_at
    // when the cap is reached — all in a single UPDATE so concurrent wrong
    // guesses cannot race past the attempt limit.
    const [updated] = await db
      .update(otpCodesTable)
      .set({
        failed_attempts: sql`${otpCodesTable.failed_attempts} + 1`,
        used_at: sql`CASE WHEN ${otpCodesTable.failed_attempts} + 1 >= ${MAX_VERIFY_ATTEMPTS} THEN NOW() ELSE ${otpCodesTable.used_at} END`,
      })
      .where(
        and(
          eq(otpCodesTable.id, otp.id),
          isNull(otpCodesTable.used_at),
        ),
      )
      .returning({ failed_attempts: otpCodesTable.failed_attempts });

    const attempts = updated?.failed_attempts ?? MAX_VERIFY_ATTEMPTS;
    req.log.warn(
      { phone, attempts, invalidated: attempts >= MAX_VERIFY_ATTEMPTS },
      "OTP verify: wrong code",
    );

    res.status(400).json({ error: invalidMsg });
    return;
  }

  // Correct code — mark as used so it cannot be replayed.
  await db
    .update(otpCodesTable)
    .set({ used_at: now })
    .where(and(eq(otpCodesTable.id, otp.id), isNull(otpCodesTable.used_at)));

  // Upsert user by phone — creates a new account on first login.
  let [user] = await db
    .insert(usersTable)
    .values({ phone })
    .onConflictDoUpdate({
      target: usersTable.phone,
      set: { updatedAt: new Date() },
    })
    .returning();

  // Ensure every user has a household at login time.
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
