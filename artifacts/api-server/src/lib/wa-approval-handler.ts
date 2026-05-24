/**
 * WhatsAppApprovalHandler
 *
 * Called after household resolution, before the full classification pipeline.
 * Checks if the inbound message is a short approval/rejection/edit/undo response
 * to the pending Vesta suggested action that was shown to this specific sender.
 *
 * Returns a typed outcome, or null to signal the caller should continue with
 * the normal inbox → classify pipeline.
 *
 * Patterns (all case-insensitive, whole-message match for approve/dismiss/undo):
 *   approve  — sim, s, ok, pode, confirmar, aceito, confirmado, vai, tá, ta,
 *              ótimo, otimo, certo, isso, exato, perfeito, bom, beleza
 *   dismiss  — não, nao, n, descartar, cancela, cancelar, errado, errada,
 *              não quero, nao quero, delete, apaga, remove
 *   edit     — "editar: [new title]", "muda para [title]", "corrige: [title]", etc.
 *   undo     — desfazer, cancela isso, errei, foi erro, engano, undo
 *
 * Undo window: 30 minutes from approval.
 *
 * Security: approvals/dismissals/edits are bound to the specific action that was
 * proposed to this sender's phone number via the wa-prompt-store. This prevents
 * a race-condition hijack where a concurrent message creates a newer pending
 * action that would otherwise be selected as "most recent" for the household.
 */

import type { Logger } from "pino";
import { db } from "@workspace/db";
import {
  suggestedActionsTable,
  inboxItemsTable,
  calendarEventsTable,
  tasksTable,
  auditLogTable,
} from "@workspace/db";
import { eq, and, desc, gte } from "drizzle-orm";
import { getPromptedActionId, clearPrompt } from "./wa-prompt-store";

export type ApprovalHandlerOutcome =
  | { kind: "approved_via_wa"; actionId: number; actionTitle: string; householdId: number }
  | { kind: "dismissed_via_wa"; actionId: number; householdId: number }
  | { kind: "edited_via_wa"; actionId: number; newTitle: string; householdId: number }
  | { kind: "undone_via_wa"; actionTitle: string; householdId: number };

const APPROVE_RE =
  /^(sim|s|ok|pode|confirmar|aceito|confirmado|vai|tá|ta|ótimo|otimo|certo|isso|exato|perfeito|bom|beleza)[\s!.]*$/i;
const DISMISS_RE =
  /^(não|nao|n|descartar|cancela|cancelar|errado|errada|não\s+quero|nao\s+quero|delete|apaga|remove)[\s!.]*$/i;
const EDIT_RE =
  /^(?:editar?|muda(?:\s+para)?|corrig[ie](?:r|ir)?|mudar\s+para|alterar?|trocar\s+para)[:\s]+(.+)$/i;
const UNDO_RE =
  /^(desfazer|cancela\s+isso|errei|foi\s+erro|engano|não\s+era\s+isso|nao\s+era\s+isso|apaga\s+isso|undo)[\s!.]*$/i;

interface ActionRow {
  id: number;
  inbox_item_id: number;
  household_id: number;
  title: string;
  type: string;
  category: string | null;
  datetime: string | null;
  notes: string | null;
  workflow_tags: string[];
}

/**
 * Attempts to interpret `body` as an approval/dismissal/edit/undo command for
 * the given household and sender. Returns a typed outcome or undefined if the
 * message should be treated as a new inbound message.
 *
 * `senderPhone` is used to look up the specific action that was proposed to this
 * sender, preventing race-condition approval hijacks.
 */
export async function handleApprovalResponse(
  body: string,
  householdId: number,
  senderPhone: string,
  log: Logger,
): Promise<ApprovalHandlerOutcome | undefined> {
  const trimmed = body.trim();

  // ── undo: check first (doesn't need a pending action) ────────────────────
  if (UNDO_RE.test(trimmed)) {
    return handleUndo(householdId, log);
  }

  const isApprove = APPROVE_RE.test(trimmed);
  const isDismiss = DISMISS_RE.test(trimmed);
  const editMatch = EDIT_RE.exec(trimmed);

  if (!isApprove && !isDismiss && !editMatch) return undefined;

  // ── find the specific action that was proposed to this sender ─────────────
  // We look up the action ID from the prompt store first (bound when the
  // proposal was sent to this phone). This prevents "most recent" selection
  // from being hijacked by a concurrent message that created a newer action.
  const promptedActionId = getPromptedActionId(senderPhone, householdId);

  let action: ActionRow | undefined;

  if (promptedActionId !== null) {
    const [found] = await db
      .select({
        id: suggestedActionsTable.id,
        inbox_item_id: suggestedActionsTable.inbox_item_id,
        household_id: suggestedActionsTable.household_id,
        title: suggestedActionsTable.title,
        type: suggestedActionsTable.type,
        category: suggestedActionsTable.category,
        datetime: suggestedActionsTable.datetime,
        notes: suggestedActionsTable.notes,
        workflow_tags: suggestedActionsTable.workflow_tags,
      })
      .from(suggestedActionsTable)
      .where(
        and(
          eq(suggestedActionsTable.id, promptedActionId),
          eq(suggestedActionsTable.household_id, householdId),
          eq(suggestedActionsTable.status, "pending"),
        ),
      )
      .limit(1);
    action = found;
  }

  if (!action) {
    // No valid prompt binding for this sender — do not fall back to "most
    // recent" for the whole household, as that would re-introduce the race
    // condition. Treat as a regular message instead.
    log.info(
      { senderPhone, householdId, promptedActionId },
      "No bound pending action for sender — treating as new message",
    );
    return undefined;
  }

  if (isApprove) {
    await createEventOrTask(action, householdId);
    await markActionStatus(action.id, action.inbox_item_id, householdId, "approved", {
      auditAction: "action_approved_via_wa",
      description: `Aprovado via WhatsApp: ${action.title}`,
      category: action.category,
    });
    clearPrompt(senderPhone);
    log.info({ actionId: action.id, title: action.title }, "Action approved via WhatsApp");
    return {
      kind: "approved_via_wa",
      actionId: action.id,
      actionTitle: action.title,
      householdId,
    };
  }

  if (isDismiss) {
    await markActionStatus(action.id, action.inbox_item_id, householdId, "dismissed", {
      auditAction: "action_dismissed_via_wa",
      description: `Descartado via WhatsApp: ${action.title}`,
      category: action.category,
    });
    clearPrompt(senderPhone);
    log.info({ actionId: action.id, title: action.title }, "Action dismissed via WhatsApp");
    return { kind: "dismissed_via_wa", actionId: action.id, householdId };
  }

  if (editMatch) {
    const newTitle = editMatch[1].trim().substring(0, 120);
    const editedAction: ActionRow = { ...action, title: newTitle };

    await createEventOrTask(editedAction, householdId);

    await db
      .update(suggestedActionsTable)
      .set({ title: newTitle, status: "approved" })
      .where(eq(suggestedActionsTable.id, action.id));

    await db
      .update(inboxItemsTable)
      .set({ status: "approved" })
      .where(eq(inboxItemsTable.id, action.inbox_item_id));

    await db.insert(auditLogTable).values({
      household_id: householdId,
      action: "action_edited_via_wa",
      actor: "whatsapp",
      action_type: "approved",
      category: action.category,
      description: `Editado via WhatsApp: ${newTitle}`,
    });

    clearPrompt(senderPhone);
    log.info({ actionId: action.id, newTitle }, "Action edited and approved via WhatsApp");
    return { kind: "edited_via_wa", actionId: action.id, newTitle, householdId };
  }

  return undefined;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function createEventOrTask(action: ActionRow, householdId: number): Promise<void> {
  if (action.type === "event" && action.datetime) {
    await db
      .insert(calendarEventsTable)
      .values({
        household_id: householdId,
        title: action.title,
        start_at: new Date(action.datetime),
        category: action.category ?? "outros",
        source: "auto",
        sync_status: "local",
        notes: action.notes ?? undefined,
      })
      .onConflictDoNothing();
  }

  if (action.type === "task" || action.type === "reminder") {
    await db.insert(tasksTable).values({
      household_id: householdId,
      title: action.title,
      status: "pending",
      category: action.category ?? "outros",
      due_at: action.datetime ? new Date(action.datetime) : undefined,
      workflow_tags: action.workflow_tags,
    });
  }
}

async function markActionStatus(
  actionId: number,
  inboxItemId: number,
  householdId: number,
  status: "approved" | "dismissed",
  audit: { auditAction: string; description: string; category: string | null },
): Promise<void> {
  await db
    .update(suggestedActionsTable)
    .set({ status })
    .where(eq(suggestedActionsTable.id, actionId));

  await db
    .update(inboxItemsTable)
    .set({ status })
    .where(eq(inboxItemsTable.id, inboxItemId));

  await db.insert(auditLogTable).values({
    household_id: householdId,
    action: audit.auditAction,
    actor: "whatsapp",
    action_type: status,
    category: audit.category,
    description: audit.description,
  });
}

async function handleUndo(
  householdId: number,
  log: Logger,
): Promise<ApprovalHandlerOutcome | undefined> {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000);

  const [action] = await db
    .select({
      id: suggestedActionsTable.id,
      inbox_item_id: suggestedActionsTable.inbox_item_id,
      household_id: suggestedActionsTable.household_id,
      title: suggestedActionsTable.title,
      category: suggestedActionsTable.category,
    })
    .from(suggestedActionsTable)
    .where(
      and(
        eq(suggestedActionsTable.household_id, householdId),
        eq(suggestedActionsTable.status, "approved"),
        gte(suggestedActionsTable.created_at, cutoff),
      ),
    )
    .orderBy(desc(suggestedActionsTable.created_at))
    .limit(1);

  if (!action) return undefined;

  await db
    .update(suggestedActionsTable)
    .set({ status: "dismissed" })
    .where(eq(suggestedActionsTable.id, action.id));

  await db
    .update(inboxItemsTable)
    .set({ status: "dismissed" })
    .where(eq(inboxItemsTable.id, action.inbox_item_id));

  await db.insert(auditLogTable).values({
    household_id: householdId,
    action: "action_undone_via_wa",
    actor: "whatsapp",
    action_type: "dismissed",
    category: action.category,
    description: `Desfeito via WhatsApp: ${action.title}`,
  });

  log.info({ actionId: action.id, title: action.title }, "Action undone via WhatsApp");
  return { kind: "undone_via_wa", actionTitle: action.title, householdId };
}
