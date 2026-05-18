import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { calendarEventsTable, householdsTable, tasksTable } from "@workspace/db";
import { eq, and, gte, lte } from "drizzle-orm";
import { sendWhatsApp, resolveHouseholdAdminPhone } from "../lib/whatsapp";
import { getHouseholdId } from "../lib/tenant";

const router = Router();

const BRIEFING_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour minimum between sends

/**
 * POST /api/briefing/send
 *
 * Sends the daily household briefing via WhatsApp to the primary admin.
 * requireAuth is applied via the protected router in routes/index.ts.
 * Cooldown is enforced via `households.last_briefing_sent_at` so it
 * survives process restarts and works across multiple instances.
 */
router.post("/briefing/send", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Não autenticado." });
    return;
  }
  try {
    const hid = getHouseholdId(req);

    const [household] = await db
      .select({ last_briefing_sent_at: householdsTable.last_briefing_sent_at })
      .from(householdsTable)
      .where(eq(householdsTable.id, hid));

    if (!household) {
      res.status(404).json({ error: "Household não encontrado." });
      return;
    }

    if (household.last_briefing_sent_at) {
      const elapsed = Date.now() - household.last_briefing_sent_at.getTime();
      if (elapsed < BRIEFING_COOLDOWN_MS) {
        const retryAfterSec = Math.ceil((BRIEFING_COOLDOWN_MS - elapsed) / 1000);
        res.setHeader("Retry-After", String(retryAfterSec));
        res.status(429).json({ error: "Briefing já enviado recentemente. Tente novamente mais tarde." });
        return;
      }
    }

    const now = new Date();
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

    let adminPhone: string | null = await resolveHouseholdAdminPhone(hid);
    if (!adminPhone) {
      adminPhone = req.user.phone ?? null;
    }

    if (!adminPhone) {
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

    await db
      .update(householdsTable)
      .set({ last_briefing_sent_at: now })
      .where(eq(householdsTable.id, hid));

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
