import { Router } from "express";
import { db } from "@workspace/db";
import { householdsTable, membersTable, rulesTable } from "@workspace/db";
import { eq, and, count, sql } from "drizzle-orm";
import { getHouseholdId, getCallerRole } from "../lib/tenant";
import { getPlanLimits } from "../lib/freemium";

const router = Router();

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
      return res.json(created);
    }

    return res.json(household);
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
      // Acquire a per-household advisory lock for the duration of this
      // transaction so concurrent inserts cannot both pass the count check.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${hid})`);

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

    const [existing] = await db
      .select()
      .from(membersTable)
      .where(and(eq(membersTable.id, id), eq(membersTable.household_id, hid)));
    if (!existing) return res.status(404).json({ error: "Not found" });

    // Admins may edit any member. Non-admins may only edit their own profile
    // and may not change role.
    const isOwnRecord = existing.user_id != null && existing.user_id === req.user?.id;
    if (callerRole !== "admin") {
      if (!isOwnRecord) {
        return res.status(403).json({ error: "Apenas administradores podem editar o perfil de outros membros" });
      }
      if (body.role !== undefined) {
        return res.status(403).json({ error: "Apenas administradores podem alterar funções de membros" });
      }
    }

    const [updated] = await db
      .update(membersTable)
      .set({
        name: body.name !== undefined ? body.name.trim() : existing.name,
        display_name: body.display_name !== undefined ? body.display_name : existing.display_name,
        role: body.role ?? existing.role,
        relationship_type: body.relationship_type ?? existing.relationship_type,
        phone: body.phone !== undefined ? body.phone : existing.phone,
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

    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete member");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
