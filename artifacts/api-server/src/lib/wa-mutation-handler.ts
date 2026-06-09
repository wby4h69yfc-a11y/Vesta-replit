/**
 * wa-mutation-handler.ts
 *
 * Handles direct-message mutation commands from household admins via WhatsApp.
 *
 * When an admin says "Cancela a reunião de quinta" or "Cria uma tarefa…" in a
 * private DM, this handler:
 *   1. Uses a lightweight LLM call to parse the intent (action + target entity)
 *   2. For cancel/delete/complete: fuzzy-matches the target from live DB data
 *   3. Presents a structured confirmation proposal ("Quer cancelar *X*? sim / não")
 *   4. Creates a `wa_conversations` row (thread_context='mutation_confirm') to
 *      track the pending mutation across the multi-turn approval loop
 *
 * Confirmation handling (SIM / NÃO) is done in wa-message-processor.ts, which
 * calls executeConfirmedMutation() when an admin replies "sim" to an open
 * mutation_confirm conversation.
 *
 * Supported actions:
 *   cancel / delete — remove or cancel an existing event or task
 *   complete        — mark a task as done
 *   create          — insert a new task or event (with confirmation)
 *
 * Security: the caller MUST verify senderIsAdmin === true before calling any
 * function here. All DB reads and writes are scoped to the caller's householdId.
 *
 * ── Scope boundaries ────────────────────────────────────────────────────────
 *
 * SINGLE-ENTITY: Each invocation handles one entity at a time. Multi-entity
 * commands ("cancela tudo de quinta") receive a "too ambiguous" reply and are
 * not executed. The admin must issue separate commands.
 *
 * DM-ONLY: The processor gates this handler to DM messages only. Group threads
 * are already blocked at the group_mutation_blocked stage.
 *
 * AI FALLBACK: When the LLM is unavailable or cannot parse the intent, the
 * handler returns an explanatory reply rather than silently falling through to
 * ingestion (which would create a confusing inbox item from a clearly
 * admin-addressed command).
 */

import type { Logger } from "pino";
import { db } from "@workspace/db";
import {
  calendarEventsTable,
  tasksTable,
  auditLogTable,
  waConversationsTable,
} from "@workspace/db";
import { eq, and, gte, desc } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";

// ── Types ─────────────────────────────────────────────────────────────────────

export type MutationAction = "cancel" | "delete" | "create" | "complete";

interface ParsedIntent {
  action: MutationAction;
  entity_type: "event" | "task" | null;
  entity_description: string;
  new_title: string | null;
  new_datetime: string | null;
  new_category: string | null;
}

interface CandidateEntity {
  kind: "event" | "task";
  id: number;
  title: string;
  datetime: string | null;
}

/** Payload shape stored in wa_conversations.proposed_payload for mutation_confirm. */
export interface MutationProposedPayload {
  action: MutationAction;
  entity_type: "event" | "task";
  entity_id: number | null;
  entity_title: string;
  entity_datetime: string | null;
  new_category: string | null;
}

// ── BRT formatting helpers ────────────────────────────────────────────────────

function formatDatetimeBRT(iso: string | null): string {
  if (!iso) return "";
  const utc = new Date(iso);
  if (isNaN(utc.getTime())) return "";
  const brt = new Date(utc.getTime() - 3 * 60 * 60 * 1000);
  const days = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  const dow = days[brt.getUTCDay()]!;
  const d = brt.getUTCDate().toString().padStart(2, "0");
  const m = (brt.getUTCMonth() + 1).toString().padStart(2, "0");
  const h = brt.getUTCHours().toString().padStart(2, "0");
  const min = brt.getUTCMinutes();
  const timePart = `${h}h${min > 0 ? min.toString().padStart(2, "0") : ""}`;
  return ` — ${dow}, ${d}/${m} às ${timePart}`;
}

// ── LLM: parse mutation intent ────────────────────────────────────────────────

const PARSE_SYSTEM_PROMPT = `Você é um interpretador de comandos para o assistente doméstico Vesta.
Analise o comando de mutação e retorne APENAS JSON sem markdown:
{
  "action": "cancel"|"delete"|"create"|"complete",
  "entity_type": "event"|"task"|null,
  "entity_description": "texto curto descrevendo o item que o usuário quer alterar",
  "new_title": "título do novo item (preencha somente para create) ou null",
  "new_datetime": "data/hora em ISO 8601 aproximado (preencha somente para create se mencionado) ou null",
  "new_category": "escola|saude|financeiro|diarista|compras|lazer|logistica|casa|outros ou null"
}
Regras:
- cancel e delete = remover ou cancelar um item existente
- complete = marcar tarefa existente como concluída
- create = criar novo item
- entity_type null = não foi possível determinar se é evento ou tarefa
Responda APENAS com JSON.`;

async function parseMutationIntent(
  text: string,
  log: Logger,
): Promise<ParsedIntent | null> {
  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 120,
      messages: [
        { role: "system", content: PARSE_SYSTEM_PROMPT },
        { role: "user", content: text.substring(0, 300) },
      ],
    });
    const raw = (resp.choices[0]?.message?.content ?? "").trim();
    const json = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    const parsed = JSON.parse(json) as Partial<ParsedIntent>;

    const action = parsed.action;
    if (!action || !["cancel", "delete", "create", "complete"].includes(action)) {
      log.warn({ raw }, "wa-mutation: LLM returned unrecognised action");
      return null;
    }
    return {
      action: action as MutationAction,
      entity_type: parsed.entity_type ?? null,
      entity_description: (parsed.entity_description ?? text).substring(0, 120),
      new_title: parsed.new_title ?? null,
      new_datetime: parsed.new_datetime ?? null,
      new_category: parsed.new_category ?? null,
    };
  } catch (err) {
    log.warn({ err }, "wa-mutation: LLM intent parse failed");
    return null;
  }
}

// ── LLM: entity matching ──────────────────────────────────────────────────────

async function findBestMatch(
  householdId: number,
  intent: ParsedIntent,
  action: MutationAction,
  log: Logger,
): Promise<CandidateEntity | null> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const candidates: CandidateEntity[] = [];

  // "complete" is only valid for tasks, never events. Skip event candidates
  // entirely so the LLM cannot accidentally match a task ID that collides with
  // an event ID in the same household.
  const allowEvents = action !== "complete";

  if (allowEvents && (intent.entity_type === "event" || intent.entity_type === null)) {
    const events = await db
      .select({
        id: calendarEventsTable.id,
        title: calendarEventsTable.title,
        start_at: calendarEventsTable.start_at,
      })
      .from(calendarEventsTable)
      .where(
        and(
          eq(calendarEventsTable.household_id, householdId),
          gte(calendarEventsTable.start_at, thirtyDaysAgo),
        ),
      )
      .orderBy(desc(calendarEventsTable.start_at))
      .limit(20);

    for (const e of events) {
      candidates.push({
        kind: "event",
        id: e.id,
        title: e.title,
        datetime: e.start_at.toISOString(),
      });
    }
  }

  if (intent.entity_type === "task" || intent.entity_type === null) {
    const tasks = await db
      .select({
        id: tasksTable.id,
        title: tasksTable.title,
        due_at: tasksTable.due_at,
      })
      .from(tasksTable)
      .where(
        and(
          eq(tasksTable.household_id, householdId),
          eq(tasksTable.status, "pending"),
        ),
      )
      .orderBy(desc(tasksTable.created_at))
      .limit(20);

    for (const t of tasks) {
      candidates.push({
        kind: "task",
        id: t.id,
        title: t.title,
        datetime: t.due_at?.toISOString() ?? null,
      });
    }
  }

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;

  // Ask LLM to pick the best match from the candidate list.
  const listText = candidates
    .map(
      (c, i) =>
        `${i + 1}. [${c.kind === "event" ? "evento" : "tarefa"}] ${c.title}${
          c.datetime ? ` (${c.datetime.slice(0, 10)})` : ""
        }`,
    )
    .join("\n");

  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 10,
      messages: [
        {
          role: "system",
          content:
            "Você receberá uma lista de itens domésticos e uma descrição. " +
            "Responda APENAS com o número do item que melhor corresponde à descrição, " +
            'ou "0" se nenhum corresponder.',
        },
        {
          role: "user",
          content: `Descrição: "${intent.entity_description}"\n\nItens:\n${listText}`,
        },
      ],
    });
    const raw = (resp.choices[0]?.message?.content ?? "0").trim();
    const idx = parseInt(raw, 10) - 1;
    if (idx >= 0 && idx < candidates.length) {
      return candidates[idx]!;
    }
    return null;
  } catch (err) {
    log.warn({ err }, "wa-mutation: entity match LLM call failed — using first candidate");
    return candidates[0] ?? null;
  }
}

// ── Phone normaliser ──────────────────────────────────────────────────────────

function normalisePhone(p: string): string {
  return p.replace(/\D/g, "");
}

// ── Proposal formatting ───────────────────────────────────────────────────────

const ACTION_LABELS: Record<MutationAction, string> = {
  cancel: "Cancelar",
  delete: "Apagar",
  create: "Criar",
  complete: "Concluir",
};

const ACTION_EMOJIS: Record<MutationAction, string> = {
  cancel: "🗑️",
  delete: "🗑️",
  create: "✅",
  complete: "✅",
};

const TYPE_LABELS: Record<string, string> = {
  event: "evento",
  task: "tarefa",
};

function buildProposalText(
  action: MutationAction,
  entityType: "event" | "task",
  entityTitle: string,
  entityDatetime: string | null,
): string {
  const emoji = ACTION_EMOJIS[action];
  const label = ACTION_LABELS[action];
  const typeLabel = TYPE_LABELS[entityType] ?? entityType;
  const dtPart = entityDatetime ? formatDatetimeBRT(entityDatetime) : "";

  return [
    `${emoji} *${label} ${typeLabel}*`,
    `_${entityTitle}_${dtPart}`,
    "",
    "Responda *sim* para confirmar ou *não* para cancelar.",
  ].join("\n");
}

// ── Main entry points ─────────────────────────────────────────────────────────

/**
 * Attempts to parse and propose a mutation for a DM admin command.
 *
 * Returns:
 *   { kind: "proposed"; proposal: string }   — proposal sent, conv created
 *   { kind: "error"; reply: string }          — couldn't parse; send reply to admin
 *   undefined                                 — shouldn't happen but allows fall-through
 *
 * Security: caller MUST verify senderIsAdmin === true before calling.
 */
export async function handleMutationIntent(
  text: string,
  householdId: number,
  senderPhone: string,
  log: Logger,
): Promise<
  | { kind: "proposed"; proposal: string }
  | { kind: "error"; reply: string }
  | undefined
> {
  const intent = await parseMutationIntent(text, log);

  if (!intent) {
    log.warn({ householdId, preview: text.substring(0, 60) }, "wa-mutation: could not parse intent");
    return {
      kind: "error",
      reply:
        "⚠️ Não consegui entender esse comando. Pode tentar de novo? Por exemplo:\n" +
        "_Cancela a reunião de quinta_ · _Cria uma tarefa: ligar pro médico amanhã_",
    };
  }

  log.info(
    { householdId, action: intent.action, entity_type: intent.entity_type, preview: text.substring(0, 60) },
    "wa-mutation: intent parsed",
  );

  let entityType: "event" | "task";
  let entityId: number | null = null;
  let entityTitle: string;
  let entityDatetime: string | null = null;

  // Dismiss any stale mutation_confirm conversations for this sender so there
  // is never more than one active proposal at a time. This prevents a "SIM"
  // reply from a previous proposal (e.g. an hour ago) from being executed when
  // the admin issues a new mutation command.
  await db
    .update(waConversationsTable)
    .set({ state: "dismissed" })
    .where(
      and(
        eq(waConversationsTable.household_id, householdId),
        eq(waConversationsTable.sender_phone, normalisePhone(senderPhone)),
        eq(waConversationsTable.thread_context, "mutation_confirm"),
        eq(waConversationsTable.state, "awaiting_confirmation"),
      ),
    );

  if (intent.action === "create") {
    // For create we don't look up an existing entity — we use the parsed details.
    const title = intent.new_title ?? intent.entity_description;
    entityType = intent.entity_type ?? "task";
    entityTitle = title.substring(0, 120);
    entityDatetime = intent.new_datetime ?? null;

    const proposal = buildProposalText(intent.action, entityType, entityTitle, entityDatetime);

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db.insert(waConversationsTable).values({
      household_id: householdId,
      sender_phone: normalisePhone(senderPhone),
      state: "awaiting_confirmation",
      thread_context: "mutation_confirm",
      proposed_payload: {
        action: intent.action,
        entity_type: entityType,
        entity_id: null,
        entity_title: entityTitle,
        entity_datetime: entityDatetime,
        new_category: intent.new_category,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      expires_at: expiresAt,
    });

    log.info(
      { householdId, action: intent.action, entityTitle },
      "wa-mutation: create proposal stored",
    );
    return { kind: "proposed", proposal };
  }

  // cancel / delete / complete — need to find the target entity
  const match = await findBestMatch(householdId, intent, intent.action, log);

  if (!match) {
    const typeHint =
      intent.entity_type === "event"
        ? "evento"
        : intent.entity_type === "task"
          ? "tarefa"
          : "item";
    return {
      kind: "error",
      reply: `🔍 Não encontrei nenhum ${typeHint} que corresponda à sua descrição. Pode me descrever melhor ou verificar no app?`,
    };
  }

  entityType = match.kind;
  entityId = match.id;
  entityTitle = match.title;
  entityDatetime = match.datetime;

  const proposal = buildProposalText(intent.action, entityType, entityTitle, entityDatetime);

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.insert(waConversationsTable).values({
    household_id: householdId,
    sender_phone: normalisePhone(senderPhone),
    state: "awaiting_confirmation",
    thread_context: "mutation_confirm",
    proposed_payload: {
      action: intent.action,
      entity_type: entityType,
      entity_id: entityId,
      entity_title: entityTitle,
      entity_datetime: entityDatetime,
      new_category: intent.new_category,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    expires_at: expiresAt,
  });

  log.info(
    { householdId, action: intent.action, entityType, entityId, entityTitle },
    "wa-mutation: proposal stored — awaiting admin confirmation",
  );

  return { kind: "proposed", proposal };
}

/**
 * Executes a confirmed mutation for an open mutation_confirm conversation.
 *
 * Reads the mutation payload from the conversation row, applies the DB change,
 * writes an audit log entry, and marks the conversation as completed.
 *
 * Returns a human-readable description of what was done, or null if the
 * conversation/payload was missing or invalid.
 *
 * Security: caller MUST verify senderIsAdmin === true and that the conversation
 * belongs to the correct household before calling.
 */
export async function executeConfirmedMutation(
  convId: number,
  payload: MutationProposedPayload,
  householdId: number,
  senderPhone: string,
  log: Logger,
): Promise<{ description: string } | null> {
  const { action, entity_type, entity_id, entity_title, entity_datetime, new_category } = payload;

  let description = "";

  try {
    if (action === "create") {
      if (entity_type === "event") {
        const startAt = entity_datetime ? new Date(entity_datetime) : new Date();
        await db.insert(calendarEventsTable).values({
          household_id: householdId,
          title: entity_title,
          start_at: startAt,
          category: new_category ?? "outros",
          source: "auto",
          sync_status: "local",
        });
        description = `Evento "${entity_title}" criado via WhatsApp.`;
      } else {
        await db.insert(tasksTable).values({
          household_id: householdId,
          title: entity_title,
          status: "pending",
          category: new_category ?? "outros",
          due_at: entity_datetime ? new Date(entity_datetime) : undefined,
        });
        description = `Tarefa "${entity_title}" criada via WhatsApp.`;
      }
    } else if (action === "complete") {
      if (!entity_id) {
        log.warn({ householdId, convId }, "wa-mutation: complete action missing entity_id");
        return null;
      }
      // Guard: complete only operates on tasks. If the stored payload somehow
      // contains entity_type "event" (e.g. due to a stale/corrupted proposal),
      // reject rather than risk completing a random task whose ID happens to match.
      if (entity_type !== "task") {
        log.warn(
          { householdId, convId, entity_type },
          "wa-mutation: complete action requires entity_type=task; rejecting",
        );
        return null;
      }
      const completedRows = await db
        .update(tasksTable)
        .set({ status: "done", completed_at: new Date() })
        .where(
          and(
            eq(tasksTable.id, entity_id),
            eq(tasksTable.household_id, householdId),
          ),
        )
        .returning({ id: tasksTable.id });
      if (completedRows.length === 0) {
        log.warn(
          { householdId, convId, entity_id },
          "wa-mutation: complete update matched no rows — task may already be done or deleted",
        );
        return null;
      }
      description = `Tarefa "${entity_title}" marcada como concluída via WhatsApp.`;
    } else if (action === "cancel" || action === "delete") {
      if (!entity_id) {
        log.warn({ householdId, convId }, "wa-mutation: cancel/delete action missing entity_id");
        return null;
      }
      if (entity_type === "event") {
        const deletedRows = await db
          .delete(calendarEventsTable)
          .where(
            and(
              eq(calendarEventsTable.id, entity_id),
              eq(calendarEventsTable.household_id, householdId),
            ),
          )
          .returning({ id: calendarEventsTable.id });
        if (deletedRows.length === 0) {
          log.warn(
            { householdId, convId, entity_id },
            "wa-mutation: cancel/delete matched no calendar event rows",
          );
          return null;
        }
        description = `Evento "${entity_title}" cancelado/apagado via WhatsApp.`;
      } else {
        const cancelledRows = await db
          .update(tasksTable)
          .set({ status: "cancelled" })
          .where(
            and(
              eq(tasksTable.id, entity_id),
              eq(tasksTable.household_id, householdId),
            ),
          )
          .returning({ id: tasksTable.id });
        if (cancelledRows.length === 0) {
          log.warn(
            { householdId, convId, entity_id },
            "wa-mutation: cancel/delete matched no task rows",
          );
          return null;
        }
        description = `Tarefa "${entity_title}" cancelada via WhatsApp.`;
      }
    } else {
      log.warn({ householdId, convId, action }, "wa-mutation: unrecognised action in payload");
      return null;
    }

    // Write audit log
    await db.insert(auditLogTable).values({
      household_id: householdId,
      action: `mutation_${action}_via_wa`,
      actor: `wa:${senderPhone}`,
      action_type: action === "create" ? "created" : action === "complete" ? "updated" : "deleted",
      category: new_category ?? null,
      description,
      metadata: {
        entity_type,
        entity_id,
        entity_title,
        wa_phone: senderPhone,
      },
    });

    // Mark conversation as completed
    await db
      .update(waConversationsTable)
      .set({ state: "completed", last_message_at: new Date() })
      .where(eq(waConversationsTable.id, convId));

    log.info(
      { householdId, action, entity_type, entity_id, entity_title },
      "wa-mutation: mutation executed and audited",
    );

    return { description };
  } catch (err) {
    log.error({ err, householdId, convId, action, entity_type, entity_id }, "wa-mutation: execution failed");
    return null;
  }
}
