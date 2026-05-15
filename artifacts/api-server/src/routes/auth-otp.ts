import crypto from "crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, gt, isNull } from "drizzle-orm";
import { db, otpCodesTable, usersTable } from "@workspace/db";
import {
  createSession,
  SESSION_COOKIE,
  SESSION_TTL,
  type SessionData,
} from "../lib/auth";
import { sendWhatsApp, isTwilioConfigured } from "../lib/whatsapp";

const router: IRouter = Router();

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

router.post("/auth/otp/send", async (req: Request, res: Response) => {
  const { phone: rawPhone } = req.body as { phone?: unknown };

  if (!rawPhone || typeof rawPhone !== "string" || rawPhone.trim().length < 8) {
    res.status(400).json({ error: "Número de telefone inválido" });
    return;
  }

  const phone = normalizePhone(rawPhone.trim());

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

  const [otp] = await db
    .select()
    .from(otpCodesTable)
    .where(
      and(
        eq(otpCodesTable.phone, phone),
        eq(otpCodesTable.code, code.trim()),
        gt(otpCodesTable.expires_at, now),
        isNull(otpCodesTable.used_at),
      ),
    )
    .limit(1);

  if (!otp) {
    res.status(400).json({ error: "Código inválido ou expirado" });
    return;
  }

  await db
    .update(otpCodesTable)
    .set({ used_at: now })
    .where(eq(otpCodesTable.id, otp.id));

  // Upsert user by phone — creates a new account on first login
  const [user] = await db
    .insert(usersTable)
    .values({ phone })
    .onConflictDoUpdate({
      target: usersTable.phone,
      set: { updatedAt: new Date() },
    })
    .returning();

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
  setSessionCookie(res, sid);

  res.json({ success: true, user: sessionData.user });
});

export default router;
