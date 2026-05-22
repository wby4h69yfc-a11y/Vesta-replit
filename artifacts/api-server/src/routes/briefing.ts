import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { calendarEventsTable, householdsTable, onboardingStateTable, tasksTable } from "@workspace/db";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { sendWhatsApp, resolveHouseholdAdminPhone } from "../lib/whatsapp";
import { getHouseholdId } from "../lib/tenant";

const router = Router();

const BRIEFING_COOLDOWN_INTERVAL = "1 hour";

/**
 * POST /api/briefing/send
 *
 * Sends the daily household briefing via WhatsApp to the primary admin.
 * requireAuth is applied via the protected router in routes/index.ts.
 *
 * Cooldown is enforced with an atomic conditional UPDATE on
 * `households.last_briefing_sent_at`. The timestamp is claimed before any
 * outbound call, so concurrent requests racing through the same gate will
 * only see one row updated. If the UPDATE touches 0 rows the cooldown is
 * still active and we return 429 immediately without sending anything.
 */
router.post("/briefing/send", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Não autenticado." });
    return;
  }
  try {
    const hid = getHouseholdId(req);
    const now = new Date();

    // Atomic test-and-set: claim the send slot only when the cooldown has
    // elapsed. Returns the old timestamp so we can compute Retry-After.
    const claimed = await db
      .update(householdsTable)
      .set({ last_briefing_sent_at: now })
      .where(
        and(
          eq(householdsTable.id, hid),
          sql`(
            ${householdsTable.last_briefing_sent_at} IS NULL
            OR ${householdsTable.last_briefing_sent_at} < NOW() - INTERVAL ${sql.raw(`'${BRIEFING_COOLDOWN_INTERVAL}'`)}
          )`,
        ),
      )
      .returning({ prev: householdsTable.last_briefing_sent_at });

    if (claimed.length === 0) {
      // Cooldown is still active — read the timestamp only to build Retry-After.
      const [row] = await db
        .select({ last_briefing_sent_at: householdsTable.last_briefing_sent_at })
        .from(householdsTable)
        .where(eq(householdsTable.id, hid));

      let retryAfterSec = 3600;
      if (row?.last_briefing_sent_at) {
        const cooldownMs = 60 * 60 * 1000;
        const elapsed = Date.now() - row.last_briefing_sent_at.getTime();
        retryAfterSec = Math.max(1, Math.ceil((cooldownMs - elapsed) / 1000));
      }
      res.setHeader("Retry-After", String(retryAfterSec));
      res.status(429).json({ error: "Briefing já enviado recentemente. Tente novamente mais tarde." });
      return;
    }

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    const events = await db
      .select()
      .from(calendarEventsTable)
      .where(
        and(
          eq(calendarEventsTable.household_id, hid),
          gte(calendarEventsTable.start_at, todayStart),
          lte(calendarEventsTable.start_at, todayEnd),
        ),
      );

    const tasks = await db
      .select()
      .from(tasksTable)
      .where(
        and(
          eq(tasksTable.household_id, hid),
          eq(tasksTable.status, "pending"),
        ),
      );

    // Defense-in-depth: require that WhatsApp was verified through the token
    // flow before delivering household data to any phone number.
    const [onboardingState] = await db
      .select({ whatsapp_verified: onboardingStateTable.whatsapp_verified })
      .from(onboardingStateTable)
      .where(eq(onboardingStateTable.household_id, hid))
      .limit(1);

    if (!onboardingState?.whatsapp_verified) {
      // Roll back the cooldown claim so the user can retry after verifying.
      await db
        .update(householdsTable)
        .set({ last_briefing_sent_at: claimed[0].prev ?? null })
        .where(eq(householdsTable.id, hid));
      res.status(400).json({
        error: "WhatsApp não verificado. Complete a verificação do número antes de enviar o resumo.",
      });
      return;
    }

    let adminPhone: string | null = await resolveHouseholdAdminPhone(hid);
    if (!adminPhone) {
      adminPhone = req.user.phone ?? null;
    }

    if (!adminPhone) {
      // Roll back the cooldown claim so the user can retry after fixing their phone.
      await db
        .update(householdsTable)
        .set({ last_briefing_sent_at: claimed[0].prev ?? null })
        .where(eq(householdsTable.id, hid));
      res.status(400).json({
        error: "Nenhum número de WhatsApp encontrado para o administrador da casa.",
      });
      return;
    }

    const dateStr = now.toLocaleDateString("pt-BR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });

    const lines: string[] = [`🏡 *Resumo do dia — ${dateStr}*`, ""];

    if (events.length > 0) {
      lines.push("📅 *Agenda de hoje:*");
      for (const ev of events) {
        const timeStr = ev.all_day
          ? "dia todo"
          : new Date(ev.start_at).toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
            });
        lines.push(`• ${ev.title} (${timeStr})`);
      }
      lines.push("");
    } else {
      lines.push("📅 Nenhum evento hoje.");
      lines.push("");
    }

    if (tasks.length > 0) {
      const shown = tasks.slice(0, 5);
      lines.push(`✅ *Tarefas pendentes (${tasks.length}):*`);
      for (const t of shown) {
        lines.push(`• ${t.title}`);
      }
      if (tasks.length > 5) {
        lines.push(`…e mais ${tasks.length - 5} tarefa(s).`);
      }
    } else {
      lines.push("✅ Nenhuma tarefa pendente.");
    }

    lines.push("");
    lines.push("_Enviado pelo Vesta — seu assistente familiar._");

    const message = lines.join("\n");
    const result = await sendWhatsApp(adminPhone, message);

    if (!result.ok) {
      req.log.warn({ error: result.error }, "Briefing send failed");
      res.status(502).json({ error: result.error });
      return;
    }

    req.log.info({ sid: result.sid, adminPhone }, "Daily briefing sent");
    res.json({
      sent: true,
      sid: result.sid,
      eventsCount: events.length,
      tasksCount: tasks.length,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to send briefing");
    res.status(500).json({ error: "Erro interno ao enviar briefing." });
  }
});

export default router;
