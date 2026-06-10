import { Router } from "express";
import crypto from "crypto";
import { db } from "@workspace/db";
import { householdsTable, membersTable, rulesTable, contactsTable, memberInvitesTable, usersTable, sessionsTable, onboardingStateTable } from "@workspace/db";
import { eq, and, count, sql, ne, isNull } from "drizzle-orm";
import { getHouseholdId, getCallerRole } from "../lib/tenant";
import { getPlanLimits } from "../lib/freemium";
import { sendWhatsApp } from "../lib/whatsapp";

const router = Router();

// ── Cross-household phone uniqueness (atomic, members) ───────────────────────
// A member phone must not collide with a contact or member phone in any other
// household. An attacker with admin rights in their own household could
// register a target provider's phone as one of their own members, causing
// the WhatsApp router to route inbound messages from that number to the wrong
// household (cross-tenant message hijack).
//
// Uniqueness is enforced atomically: the caller acquires a per-phone advisory
// lock inside a transaction before calling this function so that concurrent
// requests for the same number are serialised and cannot both pass the check.
//
// Returns true when a conflict was found (caller should return 409).
// Must be called inside a transaction that holds the advisory lock.
async function memberPhoneExistsInOtherHousehold(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  phoneNorm: string,
  ownHid: number,
  excludeMemberId?: number,
): Promise<boolean> {
  const [cm] = await tx
    .select({ id: membersTable.id })
    .from(membersTable)
    .where(
      and(
        sql`regexp_replace(${membersTable.phone}, '\\D', '', 'g') = ${phoneNorm}`,
        ne(membersTable.household_id, ownHid),
        ...(excludeMemberId !== undefined ? [ne(membersTable.id, excludeMemberId)] : []),
      ),
    )
    .limit(1);
  if (cm) return true;

  const [cc] = await tx
    .select({ id: contactsTable.id })
    .from(contactsTable)
    .where(
      and(
        sql`regexp_replace(${contactsTable.phone}, '\\D', '', 'g') = ${phoneNorm}`,
        ne(contactsTable.household_id, ownHid),
      ),
    )
    .limit(1);
  return !!cc;
}

router.get("/household", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const [household] = await db
      .select()
      .from(householdsTable)
      .where(eq(householdsTable.id, hid));

    if (!household) {
      const [created] = await db
        .insert(householdsTable)
        .values({ name: "Minha Casa", plan: "free" })
        .returning();
      return res.json({ ...created, whatsapp_alert: false });
    }

    const role = await getCallerRole(req);
    const whatsapp_alert =
      role === "admin" &&
      (household.whatsapp_consecutive_failures ?? 0) >= 2;

    return res.json({ ...household, whatsapp_alert });
  } catch (err) {
    req.log.error({ err }, "Failed to get household");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/household", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const role = await getCallerRole(req);
    if (role !== "admin") {
      return res.status(403).json({ error: "Apenas administradores podem alterar as configurações do domicílio" });
    }

    const hid = getHouseholdId(req);
    // `plan` is intentionally excluded — plan changes must go through the
    // payment/billing flow, not this settings endpoint. Accepting it here
    // would let any admin self-upgrade without a payment.
    const { name, location, briefing_hour, timezone, digest_enabled, digest_stopped, quiet_hour_start, quiet_hour_end } = req.body;

    if (briefing_hour !== undefined) {
      if (!Number.isInteger(briefing_hour) || briefing_hour < 0 || briefing_hour > 23) {
        return res.status(400).json({ error: "briefing_hour deve ser um inteiro entre 0 e 23." });
      }
    }
    if (quiet_hour_start !== undefined) {
      if (!Number.isInteger(quiet_hour_start) || quiet_hour_start < 0 || quiet_hour_start > 23) {
        return res.status(400).json({ error: "quiet_hour_start deve ser um inteiro entre 0 e 23." });
      }
    }
    if (quiet_hour_end !== undefined) {
      if (!Number.isInteger(quiet_hour_end) || quiet_hour_end < 0 || quiet_hour_end > 23) {
        return res.status(400).json({ error: "quiet_hour_end deve ser um inteiro entre 0 e 23." });
      }
    }

    if (timezone !== undefined) {
      try {
        Intl.DateTimeFormat(undefined, { timeZone: timezone });
      } catch {
        return res.status(400).json({ error: "timezone inválido. Use um nome IANA válido (ex: America/Sao_Paulo)." });
      }
    }

    const [household] = await db
      .select()
      .from(householdsTable)
      .where(eq(householdsTable.id, hid));

    if (!household) return res.status(404).json({ error: "Not found" });

    const [updated] = await db
      .update(householdsTable)
      .set({
        name: name ?? household.name,
        location: location ?? household.location,
        briefing_hour: briefing_hour !== undefined ? briefing_hour : household.briefing_hour,
        timezone: timezone ?? household.timezone,
        digest_enabled: digest_enabled !== undefined ? Boolean(digest_enabled) : household.digest_enabled,
        digest_stopped: digest_stopped !== undefined ? Boolean(digest_stopped) : household.digest_stopped,
        quiet_hour_start: quiet_hour_start !== undefined ? quiet_hour_start : household.quiet_hour_start,
        quiet_hour_end: quiet_hour_end !== undefined ? quiet_hour_end : household.quiet_hour_end,
      })
      .where(eq(householdsTable.id, hid))
      .returning();

    return res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update household");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/household/plan-status", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);

    const [household] = await db
      .select({ plan: householdsTable.plan })
      .from(householdsTable)
      .where(eq(householdsTable.id, hid));

    if (!household) return res.status(404).json({ error: "Not found" });

    const [adultRow] = await db
      .select({ total: count() })
      .from(membersTable)
      .where(and(eq(membersTable.household_id, hid), eq(membersTable.relationship_type, "adult")));

    const [childRow] = await db
      .select({ total: count() })
      .from(membersTable)
      .where(and(eq(membersTable.household_id, hid), eq(membersTable.relationship_type, "child")));

    const [ruleRow] = await db
      .select({ total: count() })
      .from(rulesTable)
      .where(eq(rulesTable.household_id, hid));

    const limits = getPlanLimits(household.plan);
    const plan = household.plan;

    return res.json({
      plan,
      limits: {
        adults: limits.adults === Infinity ? null : limits.adults,
        children: limits.children === Infinity ? null : limits.children,
        rules: limits.rules === Infinity ? null : limits.rules,
      },
      usage: {
        adults: adultRow?.total ?? 0,
        children: childRow?.total ?? 0,
        rules: ruleRow?.total ?? 0,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get plan status");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/household/members", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const members = await db
      .select()
      .from(membersTable)
      .where(eq(membersTable.household_id, hid))
      .orderBy(membersTable.created_at);
    res.json(members);
  } catch (err) {
    req.log.error({ err }, "Failed to list members");
    res.status(500).json({ error: "Internal server error" });
  }
});

const VALID_ROLES = ["admin", "member", "restricted"] as const;
const VALID_RELATIONSHIP_TYPES = ["adult", "child", "other"] as const;

type MemberRole = typeof VALID_ROLES[number];
type MemberRelationshipType = typeof VALID_RELATIONSHIP_TYPES[number];

interface MemberBody {
  name?: string;
  display_name?: string;
  role?: MemberRole;
  relationship_type?: MemberRelationshipType;
  phone?: string;
  avatar_url?: string;
  colour?: string;
  birth_year?: number;
  school?: string;
  grade?: string;
  primary_doctor?: string;
  schedule?: string;
  medical_plan?: string;
}

router.post("/household/members", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const role = await getCallerRole(req);
    if (role !== "admin") {
      return res.status(403).json({ error: "Apenas administradores podem adicionar membros ao domicílio" });
    }

    const hid = getHouseholdId(req);
    const body = req.body as MemberBody;

    if (!body.name || typeof body.name !== "string" || body.name.trim() === "") {
      return res.status(400).json({ error: "name is required" });
    }
    if (body.role !== undefined && !VALID_ROLES.includes(body.role)) {
      return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(", ")}` });
    }
    if (body.relationship_type !== undefined && !VALID_RELATIONSHIP_TYPES.includes(body.relationship_type)) {
      return res.status(400).json({ error: `relationship_type must be one of: ${VALID_RELATIONSHIP_TYPES.join(", ")}` });
    }

    const relationshipType = body.relationship_type ?? "adult";

    const member = await db.transaction(async (tx) => {
      // Acquire a per-household advisory lock so concurrent inserts cannot
      // both pass the plan-limit count check.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${hid})`);

      // If a phone number is supplied, also acquire a per-phone advisory lock
      // and verify cross-household uniqueness atomically within this transaction.
      if (body.phone) {
        const pn = body.phone.replace(/\D/g, "");
        if (pn) {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('wa_phone'::text), hashtext(${pn}::text))`);
          if (await memberPhoneExistsInOtherHousehold(tx, pn, hid)) {
            throw Object.assign(new Error("Número de telefone já cadastrado"), { status: 409 });
          }
        }
      }

      if (relationshipType === "adult" || relationshipType === "child") {
        const [household] = await tx
          .select({ plan: householdsTable.plan })
          .from(householdsTable)
          .where(eq(householdsTable.id, hid));

        if (household) {
          const limits = getPlanLimits(household.plan);
          const [countRow] = await tx
            .select({ total: count() })
            .from(membersTable)
            .where(and(eq(membersTable.household_id, hid), eq(membersTable.relationship_type, relationshipType)));

          const current = countRow?.total ?? 0;
          const limit = relationshipType === "adult" ? limits.adults : limits.children;

          if (limit !== Infinity && current >= limit) {
            const error = relationshipType === "adult"
              ? `Plano gratuito permite no máximo ${limit} adultos. Faça upgrade para adicionar mais.`
              : `Plano gratuito permite no máximo ${limit} criança. Faça upgrade para adicionar mais.`;
            throw Object.assign(new Error(error), { status: 402, limit, plan: household.plan });
          }
        }
      }

      const [inserted] = await tx
        .insert(membersTable)
        .values({
          household_id: hid,
          name: body.name!.trim(),
          display_name: body.display_name ?? null,
          role: body.role ?? "member",
          relationship_type: relationshipType,
          phone: body.phone ?? null,
          avatar_url: body.avatar_url ?? null,
          colour: body.colour ?? null,
          birth_year: body.birth_year ?? null,
          school: body.school ?? null,
          grade: body.grade ?? null,
          primary_doctor: body.primary_doctor ?? null,
          schedule: body.schedule ?? null,
          medical_plan: body.medical_plan ?? null,
        })
        .returning();

      return inserted;
    });

    res.status(201).json(member);
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string; limit?: number; plan?: string };
    if (e.status === 409) {
      return res.status(409).json({ error: e.message });
    }
    if (e.status === 402) {
      return res.status(402).json({ error: e.message, limit: e.limit, plan: e.plan });
    }
    req.log.error({ err }, "Failed to create member");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/household/members/:id", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const callerRole = await getCallerRole(req);
    const hid = getHouseholdId(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid member id" });

    const body = req.body as MemberBody;

    if (body.role !== undefined && !VALID_ROLES.includes(body.role)) {
      return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(", ")}` });
    }
    if (body.relationship_type !== undefined && !VALID_RELATIONSHIP_TYPES.includes(body.relationship_type)) {
      return res.status(400).json({ error: `relationship_type must be one of: ${VALID_RELATIONSHIP_TYPES.join(", ")}` });
    }
    if (body.name !== undefined && (typeof body.name !== "string" || body.name.trim() === "")) {
      return res.status(400).json({ error: "name must be a non-empty string" });
    }

    // Wrap the read + phone uniqueness check + update in a single transaction.
    // When the phone is changing to a new non-empty value, also acquire a
    // per-phone advisory lock before the uniqueness check so the check and
    // update are atomic across concurrent requests.
    let phoneConflict = false;
    let notFound = false;
    let forbidden: string | null = null;

    const updated = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(membersTable)
        .where(and(eq(membersTable.id, id), eq(membersTable.household_id, hid)));
      if (!existing) { notFound = true; return null; }

      // Admins may edit any member. Non-admins may only edit their own profile
      // and may not change role or phone.
      //
      // Phone changes for non-admins are blocked entirely: the only trusted
      // proof-of-ownership path is the onboarding WhatsApp token flow.
      // Allowing arbitrary phone updates via a self-edit endpoint would let any
      // authenticated user pre-claim another person's phone number as their own
      // member identity, hijacking inbound WhatsApp routing for that number.
      const isOwnRecord = existing.user_id != null && existing.user_id === req.user?.id;
      if (callerRole !== "admin") {
        if (!isOwnRecord) { forbidden = "Apenas administradores podem editar o perfil de outros membros"; return null; }
        if (body.role !== undefined) { forbidden = "Apenas administradores podem alterar funções de membros"; return null; }
        if (body.phone !== undefined) { forbidden = "Número de telefone só pode ser alterado pelo administrador do domicílio"; return null; }
      }

      const isNewPhone = body.phone !== undefined && body.phone !== null && body.phone !== "" && body.phone !== existing.phone;
      if (isNewPhone) {
        const pn = body.phone!.replace(/\D/g, "");
        if (pn) {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('wa_phone'::text), hashtext(${pn}::text))`);
          if (await memberPhoneExistsInOtherHousehold(tx, pn, hid, id)) { phoneConflict = true; return null; }
        }
      }

      const [row] = await tx
        .update(membersTable)
        .set({
          name: body.name !== undefined ? body.name.trim() : existing.name,
          display_name: body.display_name !== undefined ? body.display_name : existing.display_name,
          role: body.role ?? existing.role,
          relationship_type: body.relationship_type ?? existing.relationship_type,
          phone: body.phone !== undefined ? body.phone : existing.phone,
          // Any admin phone change resets verification. The only path that
          // sets phone_verified = true is the WhatsApp onboarding token flow,
          // which requires the member to physically send a message from the
          // number. An admin who overrides the phone must not inherit the
          // prior member's verified status; routing trust must be re-earned.
          phone_verified: isNewPhone ? false : existing.phone_verified,
          avatar_url: body.avatar_url !== undefined ? body.avatar_url : existing.avatar_url,
          colour: body.colour !== undefined ? body.colour : existing.colour,
          birth_year: body.birth_year !== undefined ? body.birth_year : existing.birth_year,
          school: body.school !== undefined ? body.school : existing.school,
          grade: body.grade !== undefined ? body.grade : existing.grade,
          primary_doctor: body.primary_doctor !== undefined ? body.primary_doctor : existing.primary_doctor,
          schedule: body.schedule !== undefined ? body.schedule : existing.schedule,
          medical_plan: body.medical_plan !== undefined ? body.medical_plan : existing.medical_plan,
        })
        .where(and(eq(membersTable.id, id), eq(membersTable.household_id, hid)))
        .returning();
      return row;
    });

    if (notFound) return res.status(404).json({ error: "Not found" });
    if (forbidden) return res.status(403).json({ error: forbidden });
    if (phoneConflict) return res.status(409).json({ error: "Número de telefone já cadastrado" });

    return res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update member");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/household/members/:id", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const role = await getCallerRole(req);
    if (role !== "admin") {
      return res.status(403).json({ error: "Apenas administradores podem remover membros do domicílio" });
    }

    const hid = getHouseholdId(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid member id" });

    const [existing] = await db
      .select()
      .from(membersTable)
      .where(and(eq(membersTable.id, id), eq(membersTable.household_id, hid)));
    if (!existing) return res.status(404).json({ error: "Not found" });

    if (existing.user_id && existing.user_id === req.user?.id) {
      return res.status(403).json({ error: "Você não pode remover seu próprio perfil do domicílio" });
    }

    await db
      .delete(membersTable)
      .where(and(eq(membersTable.id, id), eq(membersTable.household_id, hid)));

    // Revoke the removed user's access immediately so stale sessions cannot
    // be used to continue reading or mutating this household's data.
    if (existing.user_id) {
      // 1. Clear household_id on the users row — future logins will land in
      //    the onboarding flow rather than the removed household.
      await db
        .update(usersTable)
        .set({ household_id: null })
        .where(eq(usersTable.id, existing.user_id));

      // 2. Delete all active sessions for the removed user.  Sessions store
      //    the user payload as JSONB, so we match via the user.id path.
      //    This prevents a removed member from continuing to use an existing
      //    cookie or Bearer token until natural session expiry.
      await db
        .delete(sessionsTable)
        .where(sql`sess -> 'user' ->> 'id' = ${existing.user_id}`);

      req.log.info(
        { memberId: id, householdId: hid },
        "Removed member access revoked — household_id cleared and sessions deleted",
      );
    }

    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete member");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── WA invite / unlink ────────────────────────────────────────────────────────

/** Generates a 6-char alphanumeric token that always contains at least one letter. */
function generateMemberInviteToken(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = crypto.randomBytes(6);
  const suffix = Array.from(bytes, b => chars[b % chars.length]);
  // Enforce at least one letter — if all chars happened to be digits, replace index 0.
  if (!suffix.some(c => letters.includes(c))) {
    const lb = crypto.randomBytes(1)[0];
    suffix[0] = letters[lb % letters.length];
  }
  return `VESTA-${suffix.join("")}`;
}

router.post("/household/members/:id/wa-invite", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const role = await getCallerRole(req);
    if (role !== "admin") {
      return res.status(403).json({ error: "Apenas administradores podem criar convites" });
    }

    const hid = getHouseholdId(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid member id" });

    const [member] = await db
      .select()
      .from(membersTable)
      .where(and(eq(membersTable.id, id), eq(membersTable.household_id, hid)));
    if (!member) return res.status(404).json({ error: "Membro não encontrado" });

    if (member.relationship_type === "child") {
      return res.status(400).json({ error: "Convites WhatsApp são apenas para adultos" });
    }

    const domain = (process.env.REPLIT_DOMAINS ?? "").split(",").filter(Boolean)[0]
      ?? process.env.REPLIT_DEV_DOMAIN
      ?? null;

    const waNumber = process.env.TWILIO_WHATSAPP_FROM
      ?? process.env.DIALOG360_WHATSAPP_NUMBER
      ?? null;

    const token = generateMemberInviteToken();
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    await db
      .delete(memberInvitesTable)
      .where(and(
        eq(memberInvitesTable.member_id, id),
        isNull(memberInvitesTable.used_at),
      ));

    await db.insert(memberInvitesTable).values({
      household_id: hid,
      member_id: id,
      token,
      expires_at: expiresAt,
    });

    const appUrl = domain ? `https://${domain}/app` : null;
    const waDisplay = waNumber ? `+${waNumber.replace(/\D/g, "")}` : "o número do Vesta";

    const inviteText =
      `Olá, *${member.name}*! Você foi convidado(a) para o Vesta — assistente de logística da família.\n\n` +
      `Para vincular seu WhatsApp, envie a mensagem abaixo para ${waDisplay}:\n\n` +
      `*${token}*\n\n` +
      `_(Este código expira em 48 horas)_` +
      (appUrl ? `\n\nAcesse também pelo app: ${appUrl}` : "");

    req.log.info({ memberId: id, householdId: hid, tokenPrefix: token.slice(0, 9) }, "wa-invite: token generated");

    res.json({ token, invite_text: inviteText, expires_at: expiresAt.toISOString() });
  } catch (err) {
    req.log.error({ err }, "Failed to create member WA invite");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/household/members/:id/wa-link", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const role = await getCallerRole(req);
    if (role !== "admin") {
      return res.status(403).json({ error: "Apenas administradores podem desvincular WhatsApp de membros" });
    }

    const hid = getHouseholdId(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid member id" });

    const [member] = await db
      .select()
      .from(membersTable)
      .where(and(eq(membersTable.id, id), eq(membersTable.household_id, hid)));
    if (!member) return res.status(404).json({ error: "Membro não encontrado" });

    if (!member.phone) {
      return res.status(400).json({ error: "Este membro não tem WhatsApp vinculado" });
    }

    if (member.user_id && member.user_id === req.user?.id) {
      return res.status(403).json({ error: "Você não pode desvincular seu próprio WhatsApp" });
    }

    await db.transaction(async (tx) => {
      await tx
        .update(membersTable)
        .set({ phone: null })
        .where(and(eq(membersTable.id, id), eq(membersTable.household_id, hid)));

      if (member.user_id) {
        await tx
          .update(usersTable)
          .set({ phone: null })
          .where(eq(usersTable.id, member.user_id));
      }

      await tx
        .delete(memberInvitesTable)
        .where(and(
          eq(memberInvitesTable.member_id, id),
          isNull(memberInvitesTable.used_at),
        ));
    });

    const [updated] = await db
      .select()
      .from(membersTable)
      .where(eq(membersTable.id, id));

    req.log.info({ memberId: id, householdId: hid }, "wa-link: unlinked");
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to unlink member WA");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── WhatsApp number change flow ───────────────────────────────────────────────

router.get("/household/change-whatsapp/status", async (req, res) => {
  try {
    const hid = getHouseholdId(req);
    const [role, state] = await Promise.all([
      getCallerRole(req),
      db
        .select({
          whatsapp_verified: onboardingStateTable.whatsapp_verified,
          whatsapp_verified_phone: onboardingStateTable.whatsapp_verified_phone,
        })
        .from(onboardingStateTable)
        .where(eq(onboardingStateTable.household_id, hid))
        .limit(1)
        .then((rows) => rows[0]),
    ]);

    res.json({
      verified: state?.whatsapp_verified ?? false,
      verified_phone: state?.whatsapp_verified_phone ?? null,
      is_admin: role === "admin",
    });
  } catch (err) {
    req.log.error({ err }, "change-whatsapp/status: failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/household/change-whatsapp/request", async (req, res) => {
  try {
    const hid = getHouseholdId(req);

    const role = await getCallerRole(req);
    if (role !== "admin") {
      res.status(403).json({ error: "Somente administradores podem trocar o número do WhatsApp" });
      return;
    }

    const { new_phone } = req.body as { new_phone?: string };
    if (!new_phone || typeof new_phone !== "string") {
      res.status(400).json({ error: "new_phone é obrigatório" });
      return;
    }

    const normalized = new_phone.replace(/\D/g, "");
    if (normalized.length < 10 || normalized.length > 15) {
      res.status(400).json({ error: "Número de telefone inválido" });
      return;
    }

    const existing = await db
      .select({ household_id: onboardingStateTable.household_id })
      .from(onboardingStateTable)
      .where(
        and(
          eq(onboardingStateTable.whatsapp_verified_phone, normalized),
          ne(onboardingStateTable.household_id, hid),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      res.status(400).json({ error: "Este número já está cadastrado em outra conta" });
      return;
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await db
      .update(onboardingStateTable)
      .set({
        phone_change_otp: otp,
        phone_change_new_phone: normalized,
        phone_change_expires_at: expiresAt,
      })
      .where(eq(onboardingStateTable.household_id, hid));

    const result = await sendWhatsApp(
      normalized,
      `Seu código de verificação Vesta é: *${otp}*. Válido por 10 minutos. Não compartilhe com ninguém.`,
    );

    if (!result.ok) {
      req.log.warn({ householdId: hid, ok: false }, "change-whatsapp/request: failed to send OTP");
      await db
        .update(onboardingStateTable)
        .set({ phone_change_otp: null, phone_change_new_phone: null, phone_change_expires_at: null })
        .where(eq(onboardingStateTable.household_id, hid));
      res.status(400).json({ error: "Não foi possível enviar o código. Verifique o número e tente novamente." });
      return;
    }

    req.log.info({ householdId: hid }, "change-whatsapp/request: OTP sent");
    res.json({ sent: true });
  } catch (err) {
    req.log.error({ err }, "change-whatsapp/request: failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/household/change-whatsapp/confirm", async (req, res) => {
  try {
    const hid = getHouseholdId(req);
    const userId = req.user!.id;

    const role = await getCallerRole(req);
    if (role !== "admin") {
      res.status(403).json({ error: "Somente administradores podem trocar o número do WhatsApp" });
      return;
    }

    const { otp } = req.body as { otp?: string };
    if (!otp || typeof otp !== "string") {
      res.status(400).json({ error: "otp é obrigatório" });
      return;
    }

    const [state] = await db
      .select({
        phone_change_otp: onboardingStateTable.phone_change_otp,
        phone_change_new_phone: onboardingStateTable.phone_change_new_phone,
        phone_change_expires_at: onboardingStateTable.phone_change_expires_at,
      })
      .from(onboardingStateTable)
      .where(eq(onboardingStateTable.household_id, hid))
      .limit(1);

    if (!state?.phone_change_otp || !state.phone_change_new_phone || !state.phone_change_expires_at) {
      res.status(400).json({ error: "Nenhuma solicitação de troca de número pendente" });
      return;
    }

    if (state.phone_change_expires_at < new Date()) {
      res.status(400).json({ error: "Código expirado. Solicite um novo código." });
      return;
    }

    if (state.phone_change_otp !== otp.trim()) {
      res.status(400).json({ error: "Código incorreto. Verifique e tente novamente." });
      return;
    }

    const newPhone = state.phone_change_new_phone;

    // Atomic swap: re-check cross-household uniqueness + update both tables in one transaction
    await db.transaction(async (tx) => {
      const conflict = await tx
        .select({ household_id: onboardingStateTable.household_id })
        .from(onboardingStateTable)
        .where(
          and(
            eq(onboardingStateTable.whatsapp_verified_phone, newPhone),
            ne(onboardingStateTable.household_id, hid),
          ),
        )
        .limit(1);

      if (conflict.length > 0) {
        throw Object.assign(new Error("CONFLICT"), { isConflict: true });
      }

      await tx
        .update(onboardingStateTable)
        .set({
          whatsapp_verified_phone: newPhone,
          whatsapp_verified: true,
          phone_change_otp: null,
          phone_change_new_phone: null,
          phone_change_expires_at: null,
        })
        .where(eq(onboardingStateTable.household_id, hid));

      await tx
        .update(membersTable)
        .set({ phone: newPhone })
        .where(and(eq(membersTable.user_id, userId), eq(membersTable.household_id, hid)));
    });

    req.log.info({ householdId: hid }, "change-whatsapp/confirm: phone changed successfully");
    res.json({ success: true, new_phone: newPhone });
  } catch (err) {
    if (err instanceof Error && (err as Error & { isConflict?: boolean }).isConflict) {
      res.status(409).json({ error: "Este número foi registrado por outra conta. Solicite um novo código com um número diferente." });
      return;
    }
    req.log.error({ err }, "change-whatsapp/confirm: failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
