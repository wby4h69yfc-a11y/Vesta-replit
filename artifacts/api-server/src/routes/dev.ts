import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, onboardingStateTable, sessionsTable, inboxItemsTable } from "@workspace/db";
import { classifyAndSaveAction } from "../lib/classifier";
import { getHouseholdId } from "../lib/tenant";

const router: IRouter = Router();

/**
 * Dev-only routes. Guarded at mount time — only registered when
 * NODE_ENV !== "production". Never exposed in production builds.
 */

if (process.env.NODE_ENV !== "production") {
  /**
   * POST /api/dev/reset-onboarding
   *
   * Resets the authenticated user's onboarding state back to step 0.
   */
  router.post(
    "/dev/reset-onboarding",
    async (req: Request, res: Response) => {
      if (!req.isAuthenticated()) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const userId = req.user.id;

      await db
        .update(onboardingStateTable)
        .set({
          completed: false,
          current_step: 0,
          whatsapp_verified: false,
          calendar_connected: false,
          updated_at: new Date(),
        })
        .where(eq(onboardingStateTable.user_id, userId));

      req.log.info({ userId }, "Onboarding state reset (dev)");
      res.json({ ok: true, message: "Onboarding reset to step 0" });
    },
  );

  /**
   * POST /api/dev/complete-onboarding
   *
   * Fast-forwards onboarding to completed.
   */
  router.post(
    "/dev/complete-onboarding",
    async (req: Request, res: Response) => {
      if (!req.isAuthenticated()) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const userId = req.user.id;

      await db
        .update(onboardingStateTable)
        .set({
          completed: true,
          current_step: 7,
          updated_at: new Date(),
        })
        .where(eq(onboardingStateTable.user_id, userId));

      req.log.info({ userId }, "Onboarding fast-forwarded to complete (dev)");
      res.json({ ok: true, message: "Onboarding marked complete" });
    },
  );

  /**
   * DELETE /api/dev/session
   *
   * Clears the current session cookie.
   */
  router.delete("/dev/session", async (req: Request, res: Response) => {
    const sid = req.cookies?.sid;
    if (sid) {
      await db.delete(sessionsTable).where(eq(sessionsTable.sid, sid));
    }
    res.clearCookie("sid", { path: "/" });
    res.json({ ok: true, message: "Session cleared" });
  });

  /**
   * POST /api/dev/wa-simulate
   *
   * Developer test console: injects a message directly into the real
   * AI classification pipeline without going through Twilio.
   *
   * The message is attributed to the authenticated user's household,
   * bypassing the phone-based sender resolution used in production.
   * This lets developers test classification results without needing
   * a registered phone number in the members/contacts table.
   *
   * Body: { body: string, sender_phone?: string, sender_name?: string }
   */
  router.post(
    "/dev/wa-simulate",
    async (req: Request, res: Response) => {
      if (!req.isAuthenticated()) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      if (!req.user.household_id) {
        res.status(409).json({ error: "No household — complete onboarding first" });
        return;
      }

      const { body, sender_phone, sender_name } = req.body as {
        body?: string;
        sender_phone?: string;
        sender_name?: string;
      };

      if (!body?.trim()) {
        res.status(400).json({ error: "body is required" });
        return;
      }

      const householdId = getHouseholdId(req);

      try {
        // Inject directly into the household's inbox, bypassing phone resolution
        const [item] = await db
          .insert(inboxItemsTable)
          .values({
            household_id: householdId,
            source: "whatsapp",
            raw_content: body.trim(),
            media_url: null,
            status: "classifying",
            sender_name: sender_name?.trim() ?? "Dev Console",
            twilio_message_sid: null,
          })
          .returning();

        req.log.info(
          { inboxItemId: item.id, householdId },
          "Dev wa-simulate: inbox item created",
        );

        // Run the real AI classification pipeline
        await classifyAndSaveAction(item.id);
        req.log.info({ inboxItemId: item.id }, "Dev wa-simulate: classified");

        // Read back the result
        const { suggestedActionsTable } = await import("@workspace/db");
        const [action] = await db
          .select({
            approval_level: suggestedActionsTable.approval_level,
            category: suggestedActionsTable.category,
            type: suggestedActionsTable.type,
            title: suggestedActionsTable.title,
            confidence: suggestedActionsTable.confidence,
            datetime: suggestedActionsTable.datetime,
            cascade_check_needed: suggestedActionsTable.cascade_check_needed,
            workflow_tags: suggestedActionsTable.workflow_tags,
          })
          .from(suggestedActionsTable)
          .where(eq(suggestedActionsTable.inbox_item_id, item.id))
          .limit(1);

        // Determine what WhatsApp reply would be sent in the real webhook flow.
        // waEligible mirrors the logic in wa-message-processor.ts.
        const waEligible =
          action !== undefined &&
          (action.confidence ?? 0) >= 0.80 &&
          !(action.cascade_check_needed ?? false) &&
          !(action.workflow_tags ?? []).includes("payment_admin") &&
          (action.approval_level ?? "one_tap") !== "explicit";

        let proposedReply: { kind: "interactive"; buttons: string[]; body: string } | { kind: "text"; body: string } | null = null;
        if (action?.title && waEligible) {
          const { composeApprovalInteractive } = await import("../lib/wa-reply-composer");
          const interactive = composeApprovalInteractive(
            action.title,
            action.type ?? null,
            action.category ?? null,
            action.datetime ?? null,
          );
          proposedReply = {
            kind: "interactive",
            body: interactive.body,
            buttons: interactive.buttons.map((b) => b.title),
          };
        } else if (action?.title) {
          const { replyAppDeepLink } = await import("../lib/wa-reply-composer");
          const domain =
            (process.env.REPLIT_DOMAINS ?? "").split(",").filter(Boolean)[0] ??
            process.env.REPLIT_DEV_DOMAIN ??
            null;
          proposedReply = {
            kind: "text",
            body: replyAppDeepLink(action.title, domain),
          };
        }

        res.json({
          outcome: "ingested",
          inboxItemId: item.id,
          approvalLevel: action?.approval_level ?? "one_tap",
          category: action?.category,
          type: action?.type,
          title: action?.title,
          confidence: action?.confidence,
          waEligible,
          proposedReply,
          senderName: sender_name?.trim() ?? "Dev Console",
          senderPhone: sender_phone ?? null,
        });
      } catch (err) {
        req.log.error({ err }, "Dev wa-simulate: failed");
        res.status(500).json({
          outcome: "error",
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    },
  );
}

export default router;
