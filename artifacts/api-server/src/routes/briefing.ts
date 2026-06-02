import { Router, type Request, type Response } from "express";
import { getHouseholdId } from "../lib/tenant";
import { sendHouseholdBriefing } from "../lib/briefing-core";

const router = Router();

/**
 * POST /api/briefing/send
 *
 * Sends the daily household briefing via WhatsApp to the primary admin.
 * requireAuth is applied via the protected router in routes/index.ts.
 *
 * Cooldown is enforced with an atomic conditional UPDATE inside sendHouseholdBriefing.
 */
router.post("/briefing/send", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Não autenticado." });
    return;
  }
  try {
    const hid = getHouseholdId(req);

    const result = await sendHouseholdBriefing(hid);

    if (result.ok) {
      req.log.info({ sid: result.sid }, "Daily briefing sent via HTTP");
      res.json({
        sent: true,
        sid: result.sid,
        eventsCount: result.eventsCount,
        tasksCount: result.tasksCount,
      });
      return;
    }

    if (result.reason === "cooldown") {
      res.setHeader("Retry-After", String(result.retryAfterSec));
      res.status(429).json({ error: "Briefing já enviado recentemente. Tente novamente mais tarde." });
      return;
    }

    if (result.reason === "not_verified") {
      res.status(400).json({
        error: "WhatsApp não verificado. Complete a verificação do número antes de enviar o resumo.",
      });
      return;
    }

    if (result.reason === "no_phone") {
      res.status(400).json({
        error: "Nenhum número de WhatsApp encontrado para o administrador da casa.",
      });
      return;
    }

    req.log.warn({ error: result.error }, "Briefing send failed");
    res.status(502).json({ error: result.error });
  } catch (err) {
    req.log.error({ err }, "Failed to send briefing");
    res.status(500).json({ error: "Erro interno ao enviar briefing." });
  }
});

export default router;
