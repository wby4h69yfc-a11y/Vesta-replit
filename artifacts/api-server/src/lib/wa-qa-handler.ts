/**
 * wa-qa-handler.ts
 *
 * Detects when an admin sends a question about their household via WhatsApp
 * and returns a pre-composed Portuguese reply pulled from live DB data.
 *
 * Returns `undefined` when the message is not a recognised question, so the
 * caller can fall through to normal ingestion.
 *
 * Question types supported:
 *   agenda_today    — events + tasks due today
 *   agenda_tomorrow — events + tasks due tomorrow
 *   agenda_week     — events + tasks for the next 7 days
 *   tasks_open      — all open (status="pending") tasks
 *   inbox_pending   — all inbox items awaiting review
 *
 * ── Multi-turn context ───────────────────────────────────────────────────────
 *
 * A short per-sender conversation window (max 5 turns, 15-min TTL) lets the
 * LLM resolve follow-up questions like "e amanhã?" or "e para a Maria?" in
 * context.  The keyword fast-path is always tried first; the session context
 * is only injected into the LLM call when the fast-path returns null.
 *
 * ── Scope boundaries (intentional, not gaps) ────────────────────────────────
 *
 * READ-ONLY: This handler only reads household data. Mutation commands
 * ("cancela aquela reunião", "cria uma tarefa") are intercepted and returned
 * with a clear "not supported here" reply rather than falling to ingestion,
 * which would create a confusing inbox item. Mutation support is a separate
 * future feature.
 *
 * All DB queries are scoped to the caller's `householdId` — no cross-household
 * reads are possible.
 */

import type { Logger } from "pino";
import { db } from "@workspace/db";
import { calendarEventsTable, tasksTable, inboxItemsTable } from "@workspace/db";
import { eq, and, gte, lt, asc, desc, sql } from "drizzle-orm";
import { getLLMClient } from "@workspace/llm-client";
import { loadQaSession, appendQaTurn } from "./wa-qa-session-store";
import type { QATurnRecord } from "./wa-qa-session-store";

export type QuestionType =
  | "agenda_today"
  | "agenda_tomorrow"
  | "agenda_week"
  | "tasks_open"
  | "inbox_pending";

export interface QAResult {
  reply: string;
}

// ── BRT timezone helpers ──────────────────────────────────────────────────────
// Brazil Standard Time = UTC-3.  Midnight BRT = 03:00 UTC.

function brtDayRange(daysOffset: number): { start: Date; end: Date } {
  // Shift now back 3 h to get current BRT wall-clock time
  const brtNow = new Date(Date.now() - 3 * 60 * 60 * 1000);
  // Midnight of the target BRT day expressed as a UTC Date
  const midnightBRT = new Date(
    Date.UTC(
      brtNow.getUTCFullYear(),
      brtNow.getUTCMonth(),
      brtNow.getUTCDate() + daysOffset,
    ),
  );
  // Convert midnight-BRT to UTC by adding 3 h
  const start = new Date(midnightBRT.getTime() + 3 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

function brtWeekRange(): { start: Date; end: Date } {
  const today = brtDayRange(0);
  return { start: today.start, end: new Date(today.start.getTime() + 7 * 24 * 60 * 60 * 1000) };
}

/** Format a UTC Date as HH:mm in BRT (e.g. "14h" or "14h30"). */
function formatTime(utc: Date): string {
  const brt = new Date(utc.getTime() - 3 * 60 * 60 * 1000);
  const h = brt.getUTCHours().toString().padStart(2, "0");
  const m = brt.getUTCMinutes();
  return m === 0 ? `${h}h` : `${h}h${m.toString().padStart(2, "0")}`;
}

/** Format a UTC Date as "sex, 13/06" in BRT. */
function formatDate(utc: Date): string {
  const brt = new Date(utc.getTime() - 3 * 60 * 60 * 1000);
  const days = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  const dow = days[brt.getUTCDay()]!;
  const d = brt.getUTCDate().toString().padStart(2, "0");
  const m = (brt.getUTCMonth() + 1).toString().padStart(2, "0");
  return `${dow}, ${d}/${m}`;
}

/** Short dd/mm date for inline suffix. */
function shortDate(utc: Date): string {
  const brt = new Date(utc.getTime() - 3 * 60 * 60 * 1000);
  const d = brt.getUTCDate().toString().padStart(2, "0");
  const m = (brt.getUTCMonth() + 1).toString().padStart(2, "0");
  return `${d}/${m}`;
}

const CATEGORY_EMOJI: Record<string, string> = {
  escola: "📚",
  saude: "🏥",
  financeiro: "💰",
  diarista: "🧹",
  compras: "🛒",
  lazer: "🎉",
  social: "🎉",
  logistica: "🚗",
  casa: "🏠",
  servicos: "🔧",
  refeicoes: "🍽️",
  outros: "📋",
};

function catEmoji(category: string | null | undefined): string {
  return CATEGORY_EMOJI[category ?? ""] ?? "📋";
}

// ── Keyword-based question type detection ─────────────────────────────────────

const TOMORROW_RE = /\b(amanhã|amanha)\b/i;
const TODAY_RE = /\bhoje\b/i;
const WEEK_RE = /(essa|esta|próxima|proxima)\s*semana|(semana\s*que\s*vem)|próximos\s*dias/i;

/**
 * Returns true when the message carries an explicit question intent:
 * ends with "?" or starts with an interrogative word (o que, qual, quais …).
 */
function isExplicitQuestion(text: string): boolean {
  const t = text.trim();
  return (
    t.endsWith("?") ||
    /^(o\s*(que|q)\b|qual\b|quai?s?\b|me\s*(diz|conta|fala|mostra)\b|tenho\b)/i.test(t)
  );
}

/**
 * Fast-path keyword detector.  Conservative by design:
 *
 * Tier 1 — always unambiguous (no question marker needed):
 *   • `inbox` / `caixa de entrada` standing alone
 *   • `quais tarefas …`, `lista de tarefas`, `o que [tenho|tem] [pra|para] fazer`, `afazeres`
 *   • `o que tenho/tem [amanhã|hoje|semana]`
 *   • `minha agenda [timeref]` / `meu dia`
 *
 * Tier 2 — require explicit question intent (ends with `?` or starts with
 *   `o que`/`qual`/`quais`/…):
 *   • bare `agenda` keyword with a time reference
 *   • `tarefa(s)` alone
 *   • `mensagens pendentes`
 *
 * Anything that does not clearly fall into either tier returns `null` so that
 * the message is forwarded to the normal ingestion pipeline undisturbed.
 */
export function detectQuestionKeyword(text: string): QuestionType | null {
  const t = text.trim();

  // ── Tier 1: always unambiguous ──────────────────────────────────────────────

  // "inbox" / "caixa de entrada" as query term
  if (/\b(inbox|caixa\s*de\s*entrada)\b/i.test(t)) return "inbox_pending";

  // Unambiguous task queries
  if (
    /quai?s?\s*tarefa[s]?\b|lista\s*(de\s*)?tarefa[s]?\b|o\s*que\s*(está|esta|tem)\s*(pra|para)\s*fazer\b|afazeres?\b/i.test(
      t,
    )
  ) {
    return "tasks_open";
  }

  // "o que tenho/tem [timeframe]" — always an agenda question
  if (/\bo\s*que\s*(tenho|tem)\b/i.test(t)) {
    if (TOMORROW_RE.test(t)) return "agenda_tomorrow";
    if (TODAY_RE.test(t)) return "agenda_today";
    if (WEEK_RE.test(t)) return "agenda_week";
    return "agenda_tomorrow"; // ambiguous timeframe → default to tomorrow
  }

  // "minha agenda [timeref]" or "meu dia" at the start of the message
  if (/^(minha?\s*agenda|meu\s*dia)\b/i.test(t)) {
    if (TOMORROW_RE.test(t)) return "agenda_tomorrow";
    if (WEEK_RE.test(t)) return "agenda_week";
    if (TODAY_RE.test(t) || /^meu\s*dia\b/i.test(t)) return "agenda_today";
    return "agenda_tomorrow";
  }

  // ── Tier 2: ambiguous patterns — require explicit question intent ───────────
  if (!isExplicitQuestion(t)) return null;

  // Inbox — requires question marker to avoid false positives
  if (/mensagen[s]?\s*(pendente[s]?|para\s*revisar)/i.test(t)) return "inbox_pending";

  // Tasks — bare "tarefa" keyword with question marker
  if (/\btarefa[s]?\b/i.test(t)) return "tasks_open";

  // Bare "agenda" keyword with question marker + time reference
  if (/\bagenda\b/i.test(t)) {
    if (TOMORROW_RE.test(t)) return "agenda_tomorrow";
    if (TODAY_RE.test(t)) return "agenda_today";
    if (WEEK_RE.test(t)) return "agenda_week";
    return "agenda_tomorrow";
  }

  return null;
}

// ── Mutation-intent guard (read-only scope) ───────────────────────────────────
//
// Matches messages that look like direct mutation commands addressed to Vesta:
//
//   Form A — imperative verb at message start (optionally prefixed by "Vesta,"):
//     "Cancela aquela reunião"  /  "Vesta, apaga essa tarefa"
//
//   Form B — polite modal + infinitive + ?:
//     "Pode cancelar a consulta de amanhã?"  /  "Você consegue criar uma tarefa?"
//
// Deliberately narrow so forwarded statements ("Reunião cancelada — confirmar?")
// and questions with incidental mutation words ("o que foi cancelado?") do NOT
// match.  Only unambiguous, Vesta-addressed imperatives are intercepted.

const MUTATION_IMPERATIVE_RE =
  /^(?:vesta[,:\s]+)?(?:cancela|apaga|apague|cria|crie|adiciona|adicione|muda|mude|reagenda|reagende|edita|edite|altera|altere|remove|remova|deleta|delete|move|mova|transfere|transfira)\b/i;

const MUTATION_MODAL_RE =
  /^(?:vesta[,:\s]+)?(?:pode[s]?|consegue|voc[eê]\s+pode|vc\s+pode|d[aá]\s+pra|daria\s+pra)\s+(?:cancelar|apagar|criar|adicionar|mudar|reagendar|editar|alterar|remover|deletar|mover|transferir)\b/i;

/** Returns true when the message looks like a direct mutation command. */
export function isMutationCommand(text: string): boolean {
  const t = text.trim();
  return MUTATION_IMPERATIVE_RE.test(t) || MUTATION_MODAL_RE.test(t);
}

/** The exact normalised keywords that constitute a Tier-0 proactive command. */
const TIER0_KEYWORDS = new Set(["PAUSAR", "PARAR", "RETOMAR"]);

/**
 * Returns true when the message is a Tier-0 proactive control keyword
 * (PAUSAR / PARAR / RETOMAR).  These commands mutate household digest state
 * and must be sent from a private DM, not a group chat.
 */
export function isTier0Command(text: string): boolean {
  return TIER0_KEYWORDS.has(text.trim().toUpperCase());
}

// ── Follow-up detection ───────────────────────────────────────────────────────

/**
 * Returns true when the message looks like a follow-up to a prior Q&A turn
 * rather than a standalone new question.
 *
 * Signals:
 *   • Starts with "e " / "e as " / "e os " / "e para " (conjunctive)
 *   • Short message (≤ 60 chars) with a temporal or pronoun reference
 *   • Temporal shorthand like "amanhã", "hoje", "semana", "próxima" without
 *     an accompanying explicit question opener ("o que", "qual")
 *   • Pronoun reference: "ela", "ele", "eles", "elas", "isso"
 *
 * Deliberately conservative: only returns true when there is a strong signal
 * so that genuine new questions are never misrouted to the context LLM call.
 */
export function looksLikeFollowUp(text: string): boolean {
  const t = text.trim().toLowerCase();

  // Conjunctive opener — "e amanhã?", "e as tarefas?", "e para ela?"
  if (/^e\s+(a[s]?\s|o[s]?\s|para\s|de\s|do\s|da\s)/.test(t)) return true;
  if (/^e\s+(amanhã|amanha|hoje|semana|inbox|tarefas?|agenda)(?!\w)/.test(t)) return true;

  // Short (≤60 chars) message that is just a bare time reference + "?"
  if (t.length <= 60 && /^(amanhã|amanha|hoje|essa semana|esta semana|semana que vem|próxima semana)\??$/.test(t)) return true;

  // Pronoun reference without explicit question opener — only when short
  if (t.length <= 60 && /\b(ela|ele|eles|elas|isso)\b/.test(t) && !t.startsWith("o que")) return true;

  return false;
}

// ── LLM-based single-turn classification ─────────────────────────────────────

const QA_SYSTEM_PROMPT = `O usuário enviou uma mensagem pelo WhatsApp para um assistente doméstico chamado Vesta.
Classifique se a mensagem é uma pergunta sobre dados domésticos e, em caso positivo, qual tipo.
Retorne APENAS JSON: {"is_question": boolean, "type": "agenda_today"|"agenda_tomorrow"|"agenda_week"|"tasks_open"|"inbox_pending"|"other"}
Tipos:
- agenda_today: o que tenho hoje, eventos de hoje, agenda do dia
- agenda_tomorrow: o que tenho amanhã, agenda de amanhã
- agenda_week: o que tenho essa semana, agenda da semana, próximos dias
- tasks_open: tarefas pendentes/abertas, lista de tarefas, o que precisa ser feito
- inbox_pending: o que está no inbox, mensagens para revisar, pendências
Responda APENAS com o JSON, sem markdown.`;

// ── LLM-based context-aware classification (multi-turn) ──────────────────────

/**
 * Builds a context-aware system prompt that includes prior Q&A turns.
 * The LLM uses the conversation history to resolve relative references
 * ("e amanhã?" → agenda_tomorrow after an agenda_today turn).
 */
export function buildContextAwareSystemPrompt(priorTurns: QATurnRecord[]): string {
  const turnLines = priorTurns
    .map((t, i) => `  Turno ${i + 1}: pergunta="${t.q.substring(0, 150)}" → tipo_resolvido="${t.type}"`)
    .join("\n");

  return `O usuário enviou mensagens pelo WhatsApp para um assistente doméstico chamado Vesta.
Histórico recente da conversa (do mais antigo ao mais recente):
${turnLines}

Com base no histórico acima, classifique a NOVA mensagem do usuário.
Resolva referências relativas: "e amanhã?" após agenda_today → agenda_tomorrow. "e as tarefas?" → tasks_open. "e para ela/ele?" após uma pergunta sobre um membro → mantenha o mesmo tipo de dado mas para o mesmo membro.
Retorne APENAS JSON: {"is_question": boolean, "type": "agenda_today"|"agenda_tomorrow"|"agenda_week"|"tasks_open"|"inbox_pending"|"other"}
Tipos:
- agenda_today: o que tenho hoje, eventos de hoje, agenda do dia
- agenda_tomorrow: o que tenho amanhã, agenda de amanhã
- agenda_week: o que tenho essa semana, agenda da semana, próximos dias
- tasks_open: tarefas pendentes/abertas, lista de tarefas, o que precisa ser feito
- inbox_pending: o que está no inbox, mensagens para revisar, pendências
Responda APENAS com o JSON, sem markdown.`;
}

type LLMClassification =
  | { kind: "classified"; type: QuestionType | null }
  | { kind: "error" };

async function detectWithLLM(
  text: string,
  log: Logger,
  priorTurns?: QATurnRecord[],
): Promise<LLMClassification> {
  try {
    const systemPrompt =
      priorTurns && priorTurns.length > 0
        ? buildContextAwareSystemPrompt(priorTurns)
        : QA_SYSTEM_PROMPT;

    const raw = (await getLLMClient().chatCompletion(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: text.substring(0, 200) },
      ],
      { maxTokens: 50 },
    )).trim();
    const json = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    const parsed = JSON.parse(json) as { is_question?: boolean; type?: string };
    if (!parsed.is_question || !parsed.type || parsed.type === "other") {
      return { kind: "classified", type: null };
    }
    const valid: QuestionType[] = [
      "agenda_today",
      "agenda_tomorrow",
      "agenda_week",
      "tasks_open",
      "inbox_pending",
    ];
    const qType = valid.includes(parsed.type as QuestionType)
      ? (parsed.type as QuestionType)
      : null;
    return { kind: "classified", type: qType };
  } catch (err) {
    log.warn({ err }, "wa-qa: LLM call failed");
    return { kind: "error" };
  }
}

// ── Data resolvers ────────────────────────────────────────────────────────────

async function buildAgendaReply(
  householdId: number,
  dayOffset: number,
  dayLabel: string,
): Promise<string> {
  const { start, end } = brtDayRange(dayOffset);

  const [events, tasks] = await Promise.all([
    db
      .select({
        title: calendarEventsTable.title,
        start_at: calendarEventsTable.start_at,
        all_day: calendarEventsTable.all_day,
        category: calendarEventsTable.category,
      })
      .from(calendarEventsTable)
      .where(
        and(
          eq(calendarEventsTable.household_id, householdId),
          gte(calendarEventsTable.start_at, start),
          lt(calendarEventsTable.start_at, end),
        ),
      )
      .orderBy(asc(calendarEventsTable.start_at))
      .limit(10),

    db
      .select({
        title: tasksTable.title,
        due_at: tasksTable.due_at,
        category: tasksTable.category,
      })
      .from(tasksTable)
      .where(
        and(
          eq(tasksTable.household_id, householdId),
          eq(tasksTable.status, "pending"),
          gte(tasksTable.due_at, start),
          lt(tasksTable.due_at, end),
        ),
      )
      .orderBy(asc(tasksTable.due_at))
      .limit(5),
  ]);

  const dateStr = formatDate(start);
  const lines: string[] = [`📅 *Agenda de ${dayLabel}* — ${dateStr}`, ""];

  if (events.length === 0 && tasks.length === 0) {
    lines.push(`Nada agendado para ${dayLabel}. 👌`);
  } else {
    for (const ev of events) {
      const timePart = ev.all_day ? "" : ` — ${formatTime(ev.start_at)}`;
      lines.push(`• ${catEmoji(ev.category)} ${ev.title}${timePart}`);
    }
    if (tasks.length > 0) {
      if (events.length > 0) lines.push("");
      lines.push(`✅ *Vencendo ${dayLabel}*`);
      for (const t of tasks) {
        lines.push(`• ${t.title}`);
      }
    }
  }

  return lines.join("\n");
}

async function buildWeekReply(householdId: number): Promise<string> {
  const { start, end } = brtWeekRange();

  const [events, tasks] = await Promise.all([
    db
      .select({
        title: calendarEventsTable.title,
        start_at: calendarEventsTable.start_at,
        all_day: calendarEventsTable.all_day,
        category: calendarEventsTable.category,
      })
      .from(calendarEventsTable)
      .where(
        and(
          eq(calendarEventsTable.household_id, householdId),
          gte(calendarEventsTable.start_at, start),
          lt(calendarEventsTable.start_at, end),
        ),
      )
      .orderBy(asc(calendarEventsTable.start_at))
      .limit(15),

    db
      .select({
        title: tasksTable.title,
        due_at: tasksTable.due_at,
        category: tasksTable.category,
      })
      .from(tasksTable)
      .where(
        and(
          eq(tasksTable.household_id, householdId),
          eq(tasksTable.status, "pending"),
          gte(tasksTable.due_at, start),
          lt(tasksTable.due_at, end),
        ),
      )
      .orderBy(asc(tasksTable.due_at))
      .limit(10),
  ]);

  const lines: string[] = ["📅 *Agenda da semana*", ""];

  if (events.length === 0 && tasks.length === 0) {
    lines.push("Nada agendado para os próximos 7 dias. 👌");
    return lines.join("\n");
  }

  if (events.length > 0) {
    for (const ev of events) {
      const dayPart = formatDate(ev.start_at);
      const timePart = ev.all_day ? "" : ` ${formatTime(ev.start_at)}`;
      lines.push(`• ${catEmoji(ev.category)} ${ev.title} — ${dayPart}${timePart}`);
    }
  }

  if (tasks.length > 0) {
    if (events.length > 0) lines.push("");
    lines.push("✅ *Tarefas com vencimento*");
    for (const t of tasks) {
      const duePart = t.due_at ? ` _(${shortDate(t.due_at)})_` : "";
      lines.push(`• ${t.title}${duePart}`);
    }
  }

  return lines.join("\n");
}

async function buildTasksReply(householdId: number): Promise<string> {
  const tasks = await db
    .select({
      title: tasksTable.title,
      due_at: tasksTable.due_at,
      category: tasksTable.category,
    })
    .from(tasksTable)
    .where(and(eq(tasksTable.household_id, householdId), eq(tasksTable.status, "pending")))
    .orderBy(asc(tasksTable.due_at))
    .limit(10);

  if (tasks.length === 0) {
    return "✅ Nenhuma tarefa pendente por enquanto!";
  }

  const today = brtDayRange(0);
  const tomorrow = brtDayRange(1);

  const lines: string[] = [`✅ *Tarefas pendentes* (${tasks.length})`, ""];

  for (const t of tasks) {
    let suffix = "";
    if (t.due_at) {
      if (t.due_at < today.start) {
        suffix = " _(atrasada)_";
      } else if (t.due_at >= today.start && t.due_at < today.end) {
        suffix = " _(hoje)_";
      } else if (t.due_at >= tomorrow.start && t.due_at < tomorrow.end) {
        suffix = " _(amanhã)_";
      } else {
        suffix = ` _(${shortDate(t.due_at)})_`;
      }
    }
    lines.push(`• ${t.title}${suffix}`);
  }

  if (tasks.length === 10) {
    lines.push("", "_Exibindo as 10 primeiras. Abra o Vesta para ver todas._");
  }

  return lines.join("\n");
}

async function buildInboxReply(householdId: number): Promise<string> {
  const PREVIEW_LIMIT = 5;

  const [countRow, items] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(inboxItemsTable)
      .where(
        and(
          eq(inboxItemsTable.household_id, householdId),
          eq(inboxItemsTable.status, "ready_for_review"),
        ),
      ),
    db
      .select({
        raw_content: inboxItemsTable.raw_content,
        sender_name: inboxItemsTable.sender_name,
      })
      .from(inboxItemsTable)
      .where(
        and(
          eq(inboxItemsTable.household_id, householdId),
          eq(inboxItemsTable.status, "ready_for_review"),
        ),
      )
      .orderBy(desc(inboxItemsTable.created_at))
      .limit(PREVIEW_LIMIT),
  ]);

  const totalCount = Number(countRow[0]?.count ?? 0);

  if (totalCount === 0) {
    return "📬 Inbox vazio — nenhuma mensagem pendente. 👌";
  }

  const lines: string[] = [`📬 *Inbox pendente* (${totalCount})`, ""];

  for (const item of items) {
    const preview = item.raw_content.replace(/\n+/g, " ").substring(0, 55);
    const ellipsis = item.raw_content.length > 55 ? "…" : "";
    const from = item.sender_name ? ` — _${item.sender_name}_` : "";
    lines.push(`• ${preview}${ellipsis}${from}`);
  }

  if (totalCount > PREVIEW_LIMIT) {
    lines.push("", `_... e mais ${totalCount - PREVIEW_LIMIT} iten(s). Abra o Vesta para ver todos._`);
  } else {
    lines.push("", "Acesse o Vesta para revisar e aprovar.");
  }

  return lines.join("\n");
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Tries to answer a question about household data sent by an admin over
 * WhatsApp.  Returns a pre-composed reply string, or `undefined` when the
 * message is not a recognised household question (caller should fall through
 * to normal message ingestion).
 *
 * Security: caller MUST verify `senderIsAdmin === true` before calling this.
 *
 * Multi-turn: prior Q&A turns for this sender+household are loaded from the
 * session store and injected into the LLM context when the keyword fast-path
 * returns null and the message looks like a follow-up.  On success, the turn
 * is appended to the session store so subsequent follow-ups resolve correctly.
 *
 * @param text         Inbound message text
 * @param householdId  Authenticated household (already resolved by caller)
 * @param senderPhone  Raw phone string (e.g. "+5511999990000") used as session key
 * @param log          Request-scoped logger
 */
export async function handleQuestionIntent(
  text: string,
  householdId: number,
  senderPhone: string,
  log: Logger,
): Promise<QAResult | undefined> {
  // 0. Mutation guard — intercept before keyword/LLM detection.
  //    Scope boundary: this handler is READ-ONLY. Commands that would mutate
  //    household data are not supported here and must not fall through to
  //    ingestion, which would create a confusing inbox item.
  if (isMutationCommand(text)) {
    log.info(
      { householdId, preview: text.substring(0, 60) },
      "wa-qa: mutation command intercepted — read-only scope",
    );
    return {
      reply:
        "Ainda não consigo fazer alterações por aqui — só consigo responder perguntas sobre sua agenda, tarefas e caixa de entrada. Para fazer mudanças, use o app 📱",
    };
  }

  // 1. Load prior session turns (scoped to sender + household)
  const priorTurns = await loadQaSession(senderPhone, householdId);

  // 2. Keyword fast-path — no network call
  let qType = detectQuestionKeyword(text);

  // 3. Context-aware LLM fallback
  if (!qType) {
    const isFollowUp = priorTurns.length > 0 && looksLikeFollowUp(text);
    const mightBeQuestion =
      isFollowUp ||
      /\?|^(o\s*(que|q)\b|qual\b|quai?s?\b|me\s*(diz|conta|mostra)\b|tenho\b|tem\b)/i.test(
        text.trim(),
      );

    if (!mightBeQuestion) return undefined;

    // Pass prior turns to the LLM when we have context and the message is a
    // follow-up, so it can resolve relative references like "e amanhã?".
    const llmResult = await detectWithLLM(
      text,
      log,
      isFollowUp ? priorTurns : undefined,
    );

    if (llmResult.kind === "error") {
      // LLM was unavailable. The message looked like a question, so we owe the
      // admin a response rather than silently creating a spurious inbox item.
      log.warn({ householdId }, "wa-qa: LLM unavailable for likely-question — sending graceful error reply");
      return { reply: "⚠️ Não consegui processar sua pergunta agora. Tente de novo em instantes." };
    }

    qType = llmResult.type; // null means LLM determined: not a question
  }

  if (!qType) return undefined;

  const isMultiTurn = priorTurns.length > 0;
  log.info(
    { householdId, qType, multiTurn: isMultiTurn, priorTurns: priorTurns.length, preview: text.substring(0, 60) },
    "wa-qa: question detected — resolving household data",
  );

  try {
    let reply: string;
    switch (qType) {
      case "agenda_today":
        reply = await buildAgendaReply(householdId, 0, "hoje");
        break;
      case "agenda_tomorrow":
        reply = await buildAgendaReply(householdId, 1, "amanhã");
        break;
      case "agenda_week":
        reply = await buildWeekReply(householdId);
        break;
      case "tasks_open":
        reply = await buildTasksReply(householdId);
        break;
      case "inbox_pending":
        reply = await buildInboxReply(householdId);
        break;
    }

    // 4. Persist the turn so the next follow-up can resolve relative references.
    //    Fire-and-forget — a session write failure must never block the reply.
    const turn: QATurnRecord = { q: text.substring(0, 200), type: qType };
    appendQaTurn(senderPhone, householdId, turn).catch((err) => {
      log.warn({ err, householdId }, "wa-qa: failed to persist session turn (non-fatal)");
    });

    return { reply };
  } catch (err) {
    // qType was identified, so we owe the admin a response — send a graceful
    // error reply rather than silently falling through to ingestion, which
    // would create a spurious inbox item from what was clearly a question.
    log.error({ err, householdId, qType }, "wa-qa: data resolver failed — sending graceful error reply");
    return {
      reply: "⚠️ Não consegui buscar seus dados agora. Tente de novo em instantes.",
    };
  }
}
