import { Router } from "express";
import { db } from "@workspace/db";
import {
  actionCascadesTable,
  suggestedActionsTable,
  tasksTable,
  calendarEventsTable,
  paymentObligationsTable,
  auditLogTable,
} from "@workspace/db";
import { eq, and, inArray, desc } from "drizzle-orm";
import { getHouseholdId } from "../lib/tenant";
import { sendWhatsApp, resolveHouseholdAdminPhone } from "../lib/whatsapp";

const router = Router();

// GET /actions/cascades — all cascades with nested actions.
// Active cascades (≥1 pending action) are returned first (newest trigger first);
// fully-resolved cascades follow at the bottom so the UI can render summary rows.
router.get("/actions/cascades", async (req, res) => {
  try {
    const hid = getHouseholdId(req);

    // Fetch all cascades newest-first
    const cascades = await db
      .select()
      .from(actionCascadesTable)
      .where(eq(actionCascadesTable.household_id, hid))
      .orderBy(desc(actionCascadesTable.created_at));

    if (cascades.length === 0) {
      res.json([]);
      return;
    }

    const cascadeIds = cascades.map((c) => c.id);
    const actions = await db
      .select()
      .from(suggestedActionsTable)
      .where(
        and(
          eq(suggestedActionsTable.household_id, hid),
          inArray(suggestedActionsTable.cascade_id, cascadeIds),
        ),
      )
      .orderBy(suggestedActionsTable.created_at);

    const grouped = cascades.map((cascade) => ({
      ...cascade,
      actions: actions.filter((a) => a.cascade_id === cascade.id),
    }));

    // Include only cascades that have at least one action.
    // Active (pending items) come first; resolved cascades are appended at bottom.
    const withActions = grouped.filter((c) => c.actions.length > 0);
    const active   = withActions.filter((c) => c.actions.some((a) => a.status === "pending"));
    const resolved = withActions.filter((c) => !c.actions.some((a) => a.status === "pending"));

    res.json([...active, ...resolved]);
  } catch (err) {
    req.log.error({ err }, "Failed to list cascades");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /actions/cascades/:id/approve-all — approve all pending sub-items.
// Mirrors the side-effects of POST /actions/:id/approve for each sub-item:
//   event    → calendar event row
//   task/reminder/payment → task row (with payment fields if applicable)
//   payment_admin tag → payment_obligation + task backlink + WA follow-up
router.post("/actions/cascades/:id/approve-all", async (req, res) => {
  try {
    const hid = getHouseholdId(req);
    const cascadeId = parseInt(req.params.id, 10);

    const [cascade] = await db
      .select()
      .from(actionCascadesTable)
      .where(
        and(
          eq(actionCascadesTable.id, cascadeId),
          eq(actionCascadesTable.household_id, hid),
        ),
      );

    if (!cascade) {
      res.status(404).json({ error: "Cascade not found" });
      return;
    }

    const pendingActions = await db
      .select()
      .from(suggestedActionsTable)
      .where(
        and(
          eq(suggestedActionsTable.cascade_id, cascadeId),
          eq(suggestedActionsTable.household_id, hid),
          eq(suggestedActionsTable.status, "pending"),
        ),
      );

    if (pendingActions.length === 0) {
      res.json({ approved: 0 });
      return;
    }

    let hasPayment = false;

    for (const action of pendingActions) {
      const pd = action.payment_data as {
        amount_cents?: number | null;
        recipient?: string | null;
        due_date?: string | null;
        payment_method?: string | null;
      } | null;

      // ── Calendar event ──────────────────────────────────────────────────────
      if (action.type === "event" && action.datetime) {
        await db.insert(calendarEventsTable).values({
          household_id: hid,
          title:        action.title,
          start_at:     new Date(action.datetime),
          category:     action.category,
          source:       "auto",
          sync_status:  "local",
          notes:        action.notes ?? undefined,
        });
      }

      // ── Task (task / reminder / payment) ───────────────────────────────────
      let insertedTaskId: number | null = null;
      if (
        action.type === "task" ||
        action.type === "reminder" ||
        action.type === "payment"
      ) {
        const [insertedTask] = await db.insert(tasksTable).values({
          household_id:         hid,
          title:                action.title,
          status:               "pending",
          category:             action.category,
          due_at:               action.datetime ? new Date(action.datetime) : undefined,
          workflow_tags:        action.workflow_tags,
          payment_status:       action.workflow_tags.includes("payment_admin") ? "pending" : null,
          payment_amount_cents: pd?.amount_cents ?? null,
          payment_method:       pd?.payment_method ?? null,
          payment_due_date:     pd?.due_date ?? null,
        }).returning({ id: tasksTable.id });
        insertedTaskId = insertedTask?.id ?? null;
      }

      // ── Payment obligation ─────────────────────────────────────────────────
      if (action.workflow_tags.includes("payment_admin")) {
        hasPayment = true;
        const [newOb] = await db.insert(paymentObligationsTable).values({
          household_id:    hid,
          source_inbox_id: action.inbox_item_id,
          description:     action.title,
          amount_cents:    pd?.amount_cents ?? null,
          recipient:       pd?.recipient ?? null,
          due_date:        pd?.due_date ?? null,
          payment_method:  pd?.payment_method ?? null,
          status:          "pending",
        }).returning();

        if (newOb?.id != null && insertedTaskId != null) {
          await db
            .update(tasksTable)
            .set({ payment_obligation_id: newOb.id })
            .where(and(eq(tasksTable.household_id, hid), eq(tasksTable.id, insertedTaskId)));
        }
      }
    }

    // Mark all pending sub-items as approved
    const pendingIds = pendingActions.map((a) => a.id);
    await db
      .update(suggestedActionsTable)
      .set({ status: "approved" })
      .where(
        and(
          inArray(suggestedActionsTable.id, pendingIds),
          eq(suggestedActionsTable.household_id, hid),
        ),
      );

    await db.insert(auditLogTable).values({
      household_id: hid,
      action:       "cascade_approved_all",
      actor:        "user",
      action_type:  "approved",
      category:     pendingActions[0]?.category ?? "outros",
      description:  `Aprovação em cascata: ${cascade.trigger_description} (${pendingActions.length} ações)`,
    });

    // Send WA follow-up for payment cascades
    if (hasPayment) {
      try {
        const adminPhone = await resolveHouseholdAdminPhone(hid);
        if (adminPhone) {
          void sendWhatsApp(
            adminPhone,
            `💰 Pagamentos registrados da cascata: *${cascade.trigger_description}*.\n\nAo efetuar cada pagamento, responda com uma foto do comprovante para registrar automaticamente.`,
          );
        }
      } catch {
        // non-blocking
      }
    }

    res.json({ approved: pendingActions.length });
  } catch (err) {
    req.log.error({ err }, "Failed to approve cascade");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /actions/cascades/:id/dismiss-all — dismiss all pending sub-items
router.post("/actions/cascades/:id/dismiss-all", async (req, res) => {
  try {
    const hid = getHouseholdId(req);
    const cascadeId = parseInt(req.params.id, 10);

    const [cascade] = await db
      .select()
      .from(actionCascadesTable)
      .where(
        and(
          eq(actionCascadesTable.id, cascadeId),
          eq(actionCascadesTable.household_id, hid),
        ),
      );

    if (!cascade) {
      res.status(404).json({ error: "Cascade not found" });
      return;
    }

    const pendingActions = await db
      .select()
      .from(suggestedActionsTable)
      .where(
        and(
          eq(suggestedActionsTable.cascade_id, cascadeId),
          eq(suggestedActionsTable.household_id, hid),
          eq(suggestedActionsTable.status, "pending"),
        ),
      );

    if (pendingActions.length === 0) {
      res.json({ dismissed: 0 });
      return;
    }

    const pendingIds = pendingActions.map((a) => a.id);

    await db
      .update(suggestedActionsTable)
      .set({ status: "dismissed" })
      .where(
        and(
          inArray(suggestedActionsTable.id, pendingIds),
          eq(suggestedActionsTable.household_id, hid),
        ),
      );

    await db.insert(auditLogTable).values({
      household_id: hid,
      action:       "cascade_dismissed_all",
      actor:        "user",
      action_type:  "dismissed",
      category:     pendingActions[0]?.category ?? "outros",
      description:  `Dispensado em cascata: ${cascade.trigger_description} (${pendingActions.length} ações)`,
    });

    res.json({ dismissed: pendingActions.length });
  } catch (err) {
    req.log.error({ err }, "Failed to dismiss cascade");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

// Helper used by the classifier to send the deep-link WA notification
// when a cascade has ≥4 sub-items (resolution must happen in-app)
export async function notifyCascadeDeepLink(
  householdId: number,
  triggerDescription: string,
  itemCount: number,
): Promise<void> {
  const adminPhone = await resolveHouseholdAdminPhone(householdId);
  if (!adminPhone) return;
  const appDomain = process.env.REPLIT_DOMAINS?.split(",")[0] ?? "";
  const link = appDomain ? `https://${appDomain}/inbox` : "";
  const linkText = link ? `\n\n👉 ${link}` : "";
  await sendWhatsApp(
    adminPhone,
    `📋 Você tem ${itemCount} itens em cascata para revisar: *${triggerDescription}*${linkText}`,
  );
}
