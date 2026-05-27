import { Router } from "express";
import { db } from "@workspace/db";
import { householdInvitesTable, householdsTable, usersTable, membersTable } from "@workspace/db";
import { eq, and, isNull, gt } from "drizzle-orm";
import { getHouseholdId } from "../lib/tenant";
import { sendWhatsApp } from "../lib/whatsapp";
import { getSessionId, getSession, updateSession } from "../lib/auth";
import { randomBytes } from "crypto";

const router = Router();

function generateInviteCode(): string {
  return randomBytes(6).toString("hex").toUpperCase();
}

router.post("/household/invite", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    if (!req.user?.household_id) {
      return res.status(409).json({ error: "No household assigned" });
    }

    const hid = getHouseholdId(req);
    const { phone } = req.body as { phone?: string };

    if (!phone || typeof phone !== "string" || phone.trim().length < 8) {
      return res.status(400).json({ error: "phone is required (min 8 chars)" });
    }

    const [household] = await db
      .select({ name: householdsTable.name })
      .from(householdsTable)
      .where(eq(householdsTable.id, hid));
    if (!household) return res.status(404).json({ error: "Household not found" });

    const code = generateInviteCode();
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    const [invite] = await db
      .insert(householdInvitesTable)
      .values({
        code,
        household_id: hid,
        invited_phone: phone.trim(),
        invited_by_user_id: req.user?.id ?? null,
        expires_at: expiresAt,
      })
      .returning();

    const domains = process.env.REPLIT_DOMAINS?.split(",")[0] ?? "";
    const joinUrl = domains
      ? `https://${domains}/app/join/${code}`
      : `/app/join/${code}`;

    const message =
      `Você foi convidado(a) para participar do domicílio *${household.name}* no Vesta.\n\n` +
      `Acesse o link abaixo para aceitar o convite:\n${joinUrl}\n\n` +
      `Este convite expira em 48 horas.`;

    const sendResult = await sendWhatsApp(phone.trim(), message);
    if (!sendResult.ok) {
      req.log.warn({ phone, error: sendResult.error }, "Invite WhatsApp send failed (non-fatal)");
    }

    res.status(201).json({
      id: invite.id,
      code: invite.code,
      household_id: invite.household_id,
      invited_phone: invite.invited_phone,
      expires_at: invite.expires_at,
      whatsapp_sent: sendResult.ok,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create household invite");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/household/invite/:code", async (req, res) => {
  try {
    const { code } = req.params;
    const now = new Date();

    const [invite] = await db
      .select({
        id: householdInvitesTable.id,
        code: householdInvitesTable.code,
        household_id: householdInvitesTable.household_id,
        invited_phone: householdInvitesTable.invited_phone,
        expires_at: householdInvitesTable.expires_at,
        accepted_at: householdInvitesTable.accepted_at,
        household_name: householdsTable.name,
      })
      .from(householdInvitesTable)
      .innerJoin(householdsTable, eq(householdInvitesTable.household_id, householdsTable.id))
      .where(
        and(
          eq(householdInvitesTable.code, code),
          isNull(householdInvitesTable.accepted_at),
          gt(householdInvitesTable.expires_at, now),
        ),
      );

    if (!invite) {
      return res.status(404).json({ error: "Convite inválido ou expirado" });
    }

    res.json(invite);
  } catch (err) {
    req.log.error({ err }, "Failed to get household invite");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/household/join/:code", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const { code } = req.params;
    const now = new Date();
    const userId = req.user!.id;

    const [invite] = await db
      .select()
      .from(householdInvitesTable)
      .where(
        and(
          eq(householdInvitesTable.code, code),
          isNull(householdInvitesTable.accepted_at),
          gt(householdInvitesTable.expires_at, now),
        ),
      );

    if (!invite) {
      return res.status(404).json({ error: "Convite inválido ou expirado" });
    }

    const newHouseholdId = invite.household_id;

    // 1. Update the user's household in DB
    await db
      .update(usersTable)
      .set({ household_id: newHouseholdId })
      .where(eq(usersTable.id, userId));

    // 2. Mark invite as consumed
    await db
      .update(householdInvitesTable)
      .set({ accepted_at: now })
      .where(eq(householdInvitesTable.id, invite.id));

    // 3. Create or link a member record for the joining user in the new household
    const [existingMember] = await db
      .select()
      .from(membersTable)
      .where(
        and(
          eq(membersTable.household_id, newHouseholdId),
          eq(membersTable.user_id, userId),
        ),
      );

    if (!existingMember) {
      const memberName =
        req.user!.firstName ??
        req.user!.email ??
        invite.invited_phone;

      await db.insert(membersTable).values({
        household_id: newHouseholdId,
        user_id: userId,
        name: memberName,
        display_name: memberName,
        role: "member",
        relationship_type: "adult",
        phone: invite.invited_phone,
      });
    }

    // 4. Update the live session so req.user.household_id is correct immediately
    //    on subsequent requests without requiring re-login.
    const sid = getSessionId(req);
    if (sid) {
      const session = await getSession(sid);
      if (session) {
        session.user = { ...session.user, household_id: newHouseholdId };
        await updateSession(sid, session);
      }
    }
    // Also patch in-process so this response sees the new household
    req.user!.household_id = newHouseholdId;

    res.json({ success: true, household_id: newHouseholdId });
  } catch (err) {
    req.log.error({ err }, "Failed to accept household invite");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
