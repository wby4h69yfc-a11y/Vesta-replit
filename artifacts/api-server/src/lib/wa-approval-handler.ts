/**
 * WhatsAppApprovalHandler
 *
 * Called after household resolution, before the full classification pipeline.
 * Checks if the inbound message is a short approval/rejection/edit/undo response
 * to the pending Vesta suggested action that was shown to this specific sender.
 *
 * Returns a typed outcome, or undefined to signal the caller should continue with
 * the normal inbox → classify pipeline.
 *
 * State machine for a WA conversation:
 *
 *   (new message arrives) → classified → recordPrompt → awaiting_confirmation
 *     ├─ "sim"            → approved_via_wa     → completed
 *     ├─ "não"            → dismissed_via_wa    → dismissed
 *     ├─ "editar: X"      → nl_edit_proposed    → awaiting_confirmation (re-propose)
 *     ├─ "editar" alone   → edit_prompt_via_wa  → awaiting_edit
 *     │    └─ any message → nl_edit_proposed    → awaiting_confirmation (re-propose)
 *     ├─ "sim mas X"      → nl_edit_proposed    → awaiting_confirmation (re-propose)
 *     └─ "cancela/desfaz" → undo  (if completed within 5 min) OR dismiss (if still pending)
 *
 * Tier-0 positive aliases:
 *   sim, s, ok, pode, confirmar, aceito, confirmado, vai, tá, ta, ótimo, otimo,
 *   certo, isso, exato, perfeito, bom, beleza, feito, claro, combinado
 *
 * All conversation turns are audited to the audit_log table.
 *
 * Security:
 *   Approvals/dismissals/edits are bound to the specific action proposed to
 *   this sender's phone number via wa-prompt-store. This prevents a race-condition
 *   hijack where a concurrent message creates a newer pending action that would
 *   otherwise be selected as "most recent" for the household.
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
import { eq, and, desc, gte, gt } from "drizzle-orm";
import {
  normalisePhone,
  getPromptedActionId,
  completePrompt,
  dismissPrompt,
} from "./wa-prompt-store";
import { openai } from "@workspace/integrations-openai-ai-server";

export type ApprovalHandlerOutcome =
  | { kind: "approved_via_wa"; actionId: number; actionTitle: string; householdId: number }
  | { kind: "dismissed_via_wa"; actionId: number; householdId: number }
  | { kind: "nl_edit_proposed_via_wa"; actionId: number; newTitle: string; householdId: number }
  | { kind: "edit_prompt_via_wa"; actionId: number; householdId: number }
  | { kind: "undone_via_wa"; actionTitle: string; householdId: number };

// ── Intent patterns ────────────────────────────────────────────────────────────

/** All Tier-0 one-tap confirmation aliases */
const APPROVE_RE =
  /^(sim|s|ok|pode|confirmar|aceito|confirmado|vai|tá|ta|ótimo|otimo|certo|isso|exato|perfeito|bom|beleza|feito|claro|combinado)[\s!.]*$/i;

/**
 * Definitive dismiss. Does NOT include "cancela"/"cancelar" because those
 * are ambiguous — they may mean undo-within-5-min or dismiss-pending depending
 * on conversational context. handleUndoOrCancel handles that disambiguation.
 */
const DISMISS_RE =
  /^(não|nao|n|descartar|errado|errada|não\s+quero|nao\s+quero|delete|apaga|remove)[\s!.]*$/i;

/** Structured edit with inline replacement: "editar: nova versão" */
const EDIT_RE =
  /^(?:editar?|muda(?:\s+para)?|corrig[ie](?:r|ir)?|mudar\s+para|alterar?|trocar\s+para)[:\s]+(.+)$/i;

/** Standalone edit request without content — triggers awaiting_edit state */
const STANDALONE_EDIT_RE = /^(?:editar?|alterar?|mudar?)[\s!.]*$/i;

/**
 * "sim mas troca pra Pedro", "ok mas às 15h", "beleza, mas tira o lanche"
 * Positive approval with an inline natural-language amendment.
 */
const APPROVE_WITH_NL_EDIT_RE =
  /^(?:sim|s|ok|pode|confirmar|aceito|vai|tá|ta|ótimo|otimo|certo|isso|bom|beleza|feito|claro|combinado)\s*[,.]?\s+(?:mas|só\s+que|so\s+que|porém|porem|só\s*que|mas\s+(?:muda|troca|tira|adiciona|remove|coloca|bota|com|sem|às|as|para|pro|pra))\s+(.+)$/i;

/**
 * Undo / cancel intents.
 * Includes "cancela" (plain) — disambiguated by context in handleUndoOrCancel:
 *   • If completed conv within 5 min → undo
 *   • If pending proposal → dismiss
 */
const UNDO_RE =
  /^(desfazer|desfaz\s+isso|cancela\s+isso|cancelar\s+isso|cancela|cancelar|errei|foi\s+erro|engano|não\s+era\s+isso|nao\s+era\s+isso|apaga\s+isso|undo)[\s!.]*$/i;

// ── Helpers ───────────────────────────────────────────────────────────────────

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
 * Falls back to appending the edit note to the original title if OpenAI
 * is unavailable.
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
  return `${originalTitle} (${editInstruction})`.substring(0, 120);
}

async function auditTurn(
  householdId: number,
  action: string,
  actionType: string,
  category: string | null,
  description: string,
): Promise<void> {
  await db.insert(auditLogTable).values({
    household_id: householdId,
    action,
    actor: "whatsapp",
    action_type: actionType,
    category,
    description,
  });
}

/**
 * Re-propose an action with an updated title. Does NOT clear the prompt
 * (conversation stays in awaiting_confirmation).
 */
async function applyEditAndRepropose(
  action: ActionRow,
  newTitle: string,
  senderPhone: string,
): Promise<void> {
  // Update the action title so the next "sim" saves the correct title
  await db
    .update(suggestedActionsTable)
    .set({ title: newTitle })
    .where(eq(suggestedActionsTable.id, action.id));

  // Update the conversation's proposed_payload snapshot (stay in awaiting_confirmation)
  await db
    .update(waConversationsTable)
    .set({
      proposed_payload: {
        title: newTitle,
        type: action.type,
        category: action.category,
        datetime: action.datetime,
      },
      last_message_at: new Date(),
    })
    .where(
      and(
        eq(waConversationsTable.household_id, action.household_id),
        eq(waConversationsTable.sender_phone, normalisePhone(senderPhone)),
        eq(waConversationsTable.state, "awaiting_confirmation"),
      ),
    );
}

// ── Main handler ──────────────────────────────────────────────────────────────

/**
 * Attempts to interpret `body` as an approval/dismissal/edit/undo command.
 * Returns a typed outcome or undefined if this is a new inbound message.
 */
export async function handleApprovalResponse(
  body: string,
  householdId: number,
  senderPhone: string,
  log: Logger,
): Promise<ApprovalHandlerOutcome | undefined> {
  const trimmed = body.trim();
  const phoneNorm = normalisePhone(senderPhone);
  const now = new Date();

  // ── Phase 0: awaiting_edit state ─────────────────────────────────────────
  // If the user said "editar" in a previous turn, the next message is the
  // edit instruction. Check for this state before all regex matching so that
  // "não" or other keywords during an edit session aren't misinterpreted.
  const [awaitingEditConv] = await db
    .select({
      id: waConversationsTable.id,
      pending_action_id: waConversationsTable.pending_action_id,
      proposed_payload: waConversationsTable.proposed_payload,
    })
    .from(waConversationsTable)
    .where(
      and(
        eq(waConversationsTable.household_id, householdId),
        eq(waConversationsTable.sender_phone, phoneNorm),
        eq(waConversationsTable.state, "awaiting_edit"),
        gt(waConversationsTable.expires_at, now),
      ),
    )
    .orderBy(desc(waConversationsTable.created_at))
    .limit(1);

  if (awaitingEditConv?.pending_action_id) {
    const [action] = await db
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
          eq(suggestedActionsTable.id, awaitingEditConv.pending_action_id),
          eq(suggestedActionsTable.household_id, householdId),
          eq(suggestedActionsTable.status, "pending"),
        ),
      )
      .limit(1);

    if (action) {
      const newTitle = await resolveNlEdit(action.title, trimmed);
      await applyEditAndRepropose(action, newTitle, senderPhone);

      // Transition back to awaiting_confirmation
      await db
        .update(waConversationsTable)
        .set({ state: "awaiting_confirmation", last_message_at: new Date() })
        .where(eq(waConversationsTable.id, awaitingEditConv.id));

      await auditTurn(
        householdId,
        "action_edit_content_received_via_wa",
        "pending",
        action.category,
        `Instrução de edição recebida: "${trimmed}" → novo título: "${newTitle}"`,
      );

      log.info({ actionId: action.id, newTitle }, "Edit content received — re-proposing (awaiting_edit → awaiting_confirmation)");
      return { kind: "nl_edit_proposed_via_wa", actionId: action.id, newTitle, householdId };
    }
  }

  // ── Phase 1: undo / cancel ────────────────────────────────────────────────
  if (UNDO_RE.test(trimmed)) {
    return handleUndoOrCancel(householdId, senderPhone, log);
  }

  // ── Phase 2: match approve / dismiss / edit intents ───────────────────────
  const isApprove = APPROVE_RE.test(trimmed);
  const isDismiss = DISMISS_RE.test(trimmed);
  const editMatch = EDIT_RE.exec(trimmed);
  const nlEditMatch = APPROVE_WITH_NL_EDIT_RE.exec(trimmed);
  const isStandaloneEdit = STANDALONE_EDIT_RE.test(trimmed);

  if (!isApprove && !isDismiss && !editMatch && !nlEditMatch && !isStandaloneEdit) {
    return undefined;
  }

  // ── Look up the specific action proposed to this sender ───────────────────
  const promptedActionId = await getPromptedActionId(senderPhone, householdId);
  if (promptedActionId === null) {
    log.info({ senderPhone, householdId }, "No bound pending action — treating as new message");
    return undefined;
  }

  const [action] = await db
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

  if (!action) {
    log.info({ promptedActionId, householdId }, "Prompted action not found or not pending — treating as new message");
    return undefined;
  }

  // ── Standalone "editar" → prompt user for edit content ───────────────────
  if (isStandaloneEdit) {
    await db
      .update(waConversationsTable)
      .set({ state: "awaiting_edit", last_message_at: new Date() })
      .where(
        and(
          eq(waConversationsTable.household_id, householdId),
          eq(waConversationsTable.sender_phone, phoneNorm),
          eq(waConversationsTable.state, "awaiting_confirmation"),
        ),
      );

    await auditTurn(
      householdId,
      "action_edit_requested_via_wa",
      "pending",
      action.category,
      `Usuário solicitou edição via WhatsApp: ${action.title}`,
    );

    log.info({ actionId: action.id }, "Edit requested — transitioning to awaiting_edit");
    return { kind: "edit_prompt_via_wa", actionId: action.id, householdId };
  }

  // ── Natural-language inline edit ("sim mas troca pra Pedro") ─────────────
  if (nlEditMatch) {
    const editInstruction = nlEditMatch[1]?.trim() ?? "";
    const newTitle = await resolveNlEdit(action.title, editInstruction);
    await applyEditAndRepropose(action, newTitle, senderPhone);

    await auditTurn(
      householdId,
      "action_nl_edit_proposed_via_wa",
      "pending",
      action.category,
      `Edição inline proposta: "${editInstruction}" → "${newTitle}"`,
    );

    log.info({ actionId: action.id, newTitle, editInstruction }, "NL inline edit applied — re-proposing");
    return { kind: "nl_edit_proposed_via_wa", actionId: action.id, newTitle, householdId };
  }

  // ── Structured edit ("editar: nova versão") → re-propose ────────────────
  if (editMatch) {
    const newTitle = editMatch[1]!.trim().substring(0, 120);
    await applyEditAndRepropose(action, newTitle, senderPhone);

    await auditTurn(
      householdId,
      "action_edit_proposed_via_wa",
      "pending",
      action.category,
      `Edição proposta via WhatsApp: "${newTitle}"`,
    );

    // DO NOT clearPrompt — conversation stays awaiting_confirmation
    log.info({ actionId: action.id, newTitle }, "Structured edit re-proposed via WhatsApp");
    return { kind: "nl_edit_proposed_via_wa", actionId: action.id, newTitle, householdId };
  }

  // ── Approve ───────────────────────────────────────────────────────────────
  if (isApprove) {
    const artifactId = await createEventOrTask(action, householdId);

    // Write the artifact ID back into the conversation row BEFORE completing
    // so that undo can reverse the exact row rather than searching by title+time.
    if (artifactId !== null) {
      await db
        .update(waConversationsTable)
        .set({
          proposed_payload: {
            title: action.title,
            type: action.type,
            category: action.category,
            datetime: action.datetime,
            artifact_id: artifactId,
          },
        })
        .where(
          and(
            eq(waConversationsTable.household_id, householdId),
            eq(waConversationsTable.sender_phone, phoneNorm),
            eq(waConversationsTable.state, "awaiting_confirmation"),
          ),
        );
    }

    await markActionStatus(action.id, action.inbox_item_id, householdId, "approved", {
      auditAction: "action_approved_via_wa",
      description: `Aprovado via WhatsApp: ${action.title}`,
      category: action.category,
    });
    await completePrompt(senderPhone, householdId);

    log.info({ actionId: action.id, title: action.title, artifactId }, "Action approved via WhatsApp");
    return { kind: "approved_via_wa", actionId: action.id, actionTitle: action.title, householdId };
  }

  // ── Dismiss ───────────────────────────────────────────────────────────────
  if (isDismiss) {
    await markActionStatus(action.id, action.inbox_item_id, householdId, "dismissed", {
      auditAction: "action_dismissed_via_wa",
      description: `Descartado via WhatsApp: ${action.title}`,
      category: action.category,
    });
    await dismissPrompt(senderPhone, householdId);

    log.info({ actionId: action.id }, "Action dismissed via WhatsApp");
    return { kind: "dismissed_via_wa", actionId: action.id, householdId };
  }

  return undefined;
}

// ── Domain helpers ────────────────────────────────────────────────────────────

/**
 * Creates the physical event or task row on approval.
 * Returns the new row's ID so the caller can write it back into
 * wa_conversations.proposed_payload for precise undo.
 */
async function createEventOrTask(action: ActionRow, householdId: number): Promise<number | null> {
  if (action.type === "event" && action.datetime) {
    const [created] = await db
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
      .returning({ id: calendarEventsTable.id });
    return created?.id ?? null;
  }

  if (action.type === "task" || action.type === "reminder") {
    const [created] = await db
      .insert(tasksTable)
      .values({
        household_id: householdId,
        title: action.title,
        status: "pending",
        category: action.category ?? "outros",
        due_at: action.datetime ? new Date(action.datetime) : undefined,
        workflow_tags: action.workflow_tags,
      })
      .returning({ id: tasksTable.id });
    return created?.id ?? null;
  }

  return null;
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

  await auditTurn(householdId, audit.auditAction, status, audit.category, audit.description);
}

/**
 * Handles undo/cancel commands with context-aware disambiguation.
 *
 * Tries undo first (if there's a completed conversation within 5 minutes),
 * then falls back to dismiss if a pending proposal exists.
 * Returns undefined if neither applies.
 */
async function handleUndoOrCancel(
  householdId: number,
  senderPhone: string,
  log: Logger,
): Promise<ApprovalHandlerOutcome | undefined> {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

  // ── 1. Try undo: completed conversation within 5-min window ──────────────
  // Scope by BOTH household_id AND sender_phone to prevent cross-admin undo:
  // if two admins act in the same household, "cancela" from one must not undo
  // the other's most recent action.
  const [conv] = await db
    .select({
      pending_action_id: waConversationsTable.pending_action_id,
      proposed_payload: waConversationsTable.proposed_payload,
    })
    .from(waConversationsTable)
    .where(
      and(
        eq(waConversationsTable.household_id, householdId),
        eq(waConversationsTable.sender_phone, normalisePhone(senderPhone)),
        eq(waConversationsTable.state, "completed"),
        gte(waConversationsTable.last_message_at, fiveMinAgo),
      ),
    )
    .orderBy(desc(waConversationsTable.last_message_at))
    .limit(1);

  if (conv?.pending_action_id) {
    const [action] = await db
      .select({
        id: suggestedActionsTable.id,
        inbox_item_id: suggestedActionsTable.inbox_item_id,
        title: suggestedActionsTable.title,
        type: suggestedActionsTable.type,
        category: suggestedActionsTable.category,
      })
      .from(suggestedActionsTable)
      .where(
        and(
          eq(suggestedActionsTable.id, conv.pending_action_id),
          eq(suggestedActionsTable.household_id, householdId),
          eq(suggestedActionsTable.status, "approved"),
        ),
      )
      .limit(1);

    if (action) {
      // artifact_id is persisted at approval time for precise reversal;
      // fall back to title+time matching for pre-migration conversations.
      const artifactId = conv.proposed_payload?.artifact_id;

      // Reverse physical records created by the approval
      if (action.type === "task" || action.type === "reminder") {
        if (artifactId) {
          await db
            .update(tasksTable)
            .set({ status: "cancelled" })
            .where(
              and(
                eq(tasksTable.id, artifactId),
                eq(tasksTable.household_id, householdId),
              ),
            );
        } else {
          await db
            .update(tasksTable)
            .set({ status: "cancelled" })
            .where(
              and(
                eq(tasksTable.household_id, householdId),
                eq(tasksTable.title, action.title),
                gte(tasksTable.created_at, fiveMinAgo),
              ),
            );
        }
      }
      if (action.type === "event") {
        if (artifactId) {
          await db
            .delete(calendarEventsTable)
            .where(
              and(
                eq(calendarEventsTable.id, artifactId),
                eq(calendarEventsTable.household_id, householdId),
              ),
            );
        } else {
          await db
            .delete(calendarEventsTable)
            .where(
              and(
                eq(calendarEventsTable.household_id, householdId),
                eq(calendarEventsTable.title, action.title),
                gte(calendarEventsTable.created_at, fiveMinAgo),
              ),
            );
        }
      }

      // Flip action + inbox item
      await db.update(suggestedActionsTable).set({ status: "dismissed" }).where(eq(suggestedActionsTable.id, action.id));
      await db.update(inboxItemsTable).set({ status: "dismissed" }).where(eq(inboxItemsTable.id, action.inbox_item_id));

      // Close the conversation row
      await db
        .update(waConversationsTable)
        .set({ state: "dismissed" })
        .where(
          and(
            eq(waConversationsTable.household_id, householdId),
            eq(waConversationsTable.pending_action_id, conv.pending_action_id),
            eq(waConversationsTable.state, "completed"),
          ),
        );

      await auditTurn(
        householdId,
        "action_undone_via_wa",
        "dismissed",
        action.category,
        `Desfeito via WhatsApp: ${action.title}`,
      );

      log.info({ actionId: action.id, title: action.title }, "Action undone via WhatsApp");
      return { kind: "undone_via_wa", actionTitle: action.title, householdId };
    }
  }

  // ── 2. Fallback: dismiss a pending proposal ───────────────────────────────
  // "cancela" with no recently completed action → user is dismissing the
  // current pending proposal.
  const promptedActionId = await getPromptedActionId(senderPhone, householdId);
  if (promptedActionId !== null) {
    const [pendingAction] = await db
      .select({
        id: suggestedActionsTable.id,
        inbox_item_id: suggestedActionsTable.inbox_item_id,
        title: suggestedActionsTable.title,
        category: suggestedActionsTable.category,
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

    if (pendingAction) {
      await markActionStatus(pendingAction.id, pendingAction.inbox_item_id, householdId, "dismissed", {
        auditAction: "action_dismissed_via_wa",
        description: `Descartado via WhatsApp (cancela): ${pendingAction.title}`,
        category: pendingAction.category,
      });
      await dismissPrompt(senderPhone, householdId);

      log.info({ actionId: pendingAction.id }, "Pending proposal dismissed via 'cancela'");
      return { kind: "dismissed_via_wa", actionId: pendingAction.id, householdId };
    }
  }

  return undefined;
}
