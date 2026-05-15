import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { calendarEventsTable, tasksTable } from "@workspace/db";
import { eq, and, gte, lte } from "drizzle-orm";
import { sendWhatsApp } from "../lib/whatsapp";

const router = Router();

/**
 * POST /api/briefing/send
 *
 * Sends the daily household briefing via WhatsApp to the primary admin.
 * Requires authentication (authMiddleware is applied globally in app.ts).
 * Can be triggered manually or by a future cron job.
 */
router.post("/briefing/send", async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "Não autenticado." });
    return;
  }
  try {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    // Fetch today's events
    const events = await db
      .select()
      .from(calendarEventsTable)
      .where(
        and(
          gte(calendarEventsTable.start_at, todayStart),
          lte(calendarEventsTable.start_at, todayEnd),
        ),
      );

    // Fetch pending tasks
    const tasks = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.status, "pending"));

    // Determine admin phone from the authenticated user
    const adminPhone: string | null = req.user?.phone ?? null;

    if (!adminPhone) {
      res.status(400).json({
        error: "Nenhum número de WhatsApp cadastrado na sua conta. Faça login com seu número de telefone.",
      });
      return;
    }

    // Format message
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
