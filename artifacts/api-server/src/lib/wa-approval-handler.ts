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
 *   approve     — sim, s, ok, pode, confirmar, aceito, confirmado, vai, tá, ta,
 *                 ótimo, otimo, certo, isso, exato, perfeito, bom, beleza
 *   dismiss     — não, nao, n, descartar, cancela, cancelar, errado, errada,
 *                 não quero, nao quero, delete, apaga, remove
 *   edit        — "editar: [new title]", "muda para [title]", "corrige: [title]", etc.
 *   approve+NL  — "sim mas troca pra Pedro", "ok, mas às 15h" — positive with inline edit
 *   undo        — desfazer, cancela isso, errei, foi erro, engano, undo
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
  waConversationsTable,
} from "@workspace/db";
import { eq, and, desc, gte } from "drizzle-orm";
import { normalisePhone, getPromptedActionId, clearPrompt } from "./wa-prompt-store";
import { openai } from "@workspace/integrations-openai-ai-server";

export type ApprovalHandlerOutcome =
  | { kind: "approved_via_wa"; actionId: number; actionTitle: string; householdId: number }
  | { kind: "dismissed_via_wa"; actionId: number; householdId: number }
  | { kind: "edited_via_wa"; actionId: number; newTitle: string; householdId: number }
  | { kind: "nl_edit_proposed_via_wa"; actionId: number; newTitle: string; householdId: number }
  | { kind: "undone_via_wa"; actionTitle: string; householdId: number };

const APPROVE_RE =
  /^(sim|s|ok|pode|confirmar|aceito|confirmado|vai|tá|ta|ótimo|otimo|certo|isso|exato|perfeito|bom|beleza)[\s!.]*$/i;

const DISMISS_RE =
  /^(não|nao|n|descartar|cancela|cancelar|errado|errada|não\s+quero|nao\s+quero|delete|apaga|remove)[\s!.]*$/i;

const EDIT_RE =
  /^(?:editar?|muda(?:\s+para)?|corrig[ie](?:r|ir)?|mudar\s+para|alterar?|trocar\s+para)[:\s]+(.+)$/i;

/**
 * "sim mas troca pra Pedro", "ok mas às 15h", "beleza, mas tira o lanche"
 * Positive approval with an inline natural-language amendment.
 */
const APPROVE_WITH_NL_EDIT_RE =
  /^(?:sim|s|ok|pode|confirmar|aceito|vai|tá|ta|ótimo|otimo|certo|isso|bom|beleza)\s*[,.]?\s+(?:mas|só\s+que|so\s+que|porém|porem|só\s*que|mas\s+(?:muda|troca|tira|adiciona|remove|coloca|bota|com|sem|às|as|para|pro|pra))\s+(.+)$/i;

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
 * Resolve a natural-language edit instruction to a new title string.
 * Falls back to the original title + note if OpenAI is unavailable.
 */
async function resolveNlEdit(originalTitle: string, editInstruction: string): Promise<string> {
  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 60,
      messages: [
        {
          role: "system",
          content:
            "Você é um assistente que atualiza títulos de ações domésticas em português. " +
            "Recebe o título atual e uma instrução de edição e retorna APENAS o novo título, sem aspas, sem explicações.",
        },
        {
          role: "user",
          content: `Título atual: "${originalTitle}"\nInstrução de edição: "${editInstruction}"\nNovo título:`,
        },
      ],
    });
    const newTitle = resp.choices[0]?.message?.content?.trim();
    if (newTitle && newTitle.length > 0) return newTitle.substring(0, 120);
  } catch {
    // fall through to deterministic fallback
  }
  // Deterministic fallback: append the edit instruction as a note
  return `${originalTitle} (${editInstruction})`.substring(0, 120);
}

/**
 * Attempts to interpret `body` as an approval/dismissal/edit/undo command for
 * the given household and sender. Returns a typed outcome or undefined if the
 * message should be treated as a new inbound message.
 *
 * `senderPhone` is used to look up the specific action that was proposed to this
 * sender, preventing race-condition approval hijacks.
 *
 * NOTE: All prompt-store calls are now async (DB-backed).
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
  const nlEditMatch = APPROVE_WITH_NL_EDIT_RE.exec(trimmed);

  if (!isApprove && !isDismiss && !editMatch && !nlEditMatch) return undefined;

  // ── find the specific action that was proposed to this sender ─────────────
  const promptedActionId = await getPromptedActionId(senderPhone, householdId);

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
    log.info(
      { senderPhone, householdId, promptedActionId },
      "No bound pending action for sender — treating as new message",
    );
    return undefined;
  }

  // ── Natural-language inline edit ("sim mas troca pra Pedro") ─────────────
  if (nlEditMatch) {
    const editInstruction = nlEditMatch[1]?.trim() ?? "";
    const newTitle = await resolveNlEdit(action.title, editInstruction);

    // Update wa_conversations with the new proposed payload then re-propose.
    // We keep state as awaiting_confirmation so the user can confirm the edit.
    await db
      .update(waConversationsTable)
      .set({
        proposed_payload: { title: newTitle, type: action.type, category: action.category, datetime: action.datetime },
        last_message_at: new Date(),
      })
      .where(
        and(
          eq(waConversationsTable.household_id, householdId),
          eq(waConversationsTable.sender_phone, normalisePhone(senderPhone)),
          eq(waConversationsTable.state, "awaiting_confirmation"),
        ),
      );

    // Also update the pending action's title so if finally approved it saves correctly
    await db
      .update(suggestedActionsTable)
      .set({ title: newTitle })
      .where(eq(suggestedActionsTable.id, action.id));

    log.info({ actionId: action.id, newTitle, editInstruction }, "NL inline edit applied — re-proposing");
    return { kind: "nl_edit_proposed_via_wa", actionId: action.id, newTitle, householdId };
  }

  if (isApprove) {
    await createEventOrTask(action, householdId);
    await markActionStatus(action.id, action.inbox_item_id, householdId, "approved", {
      auditAction: "action_approved_via_wa",
      description: `Aprovado via WhatsApp: ${action.title}`,
      category: action.category,
    });
    await clearPrompt(senderPhone);
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
    await clearPrompt(senderPhone);
    log.info({ actionId: action.id, title: action.title }, "Action dismissed via WhatsApp");
    return { kind: "dismissed_via_wa", actionId: action.id, householdId };
  }

  if (editMatch) {
    const newTitle = editMatch[1]!.trim().substring(0, 120);
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

    await clearPrompt(senderPhone);
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
