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
 * All DB queries are scoped to the caller's `householdId` — no cross-household
 * reads are possible.
 */

import type { Logger } from "pino";
import { db } from "@workspace/db";
import { calendarEventsTable, tasksTable, inboxItemsTable } from "@workspace/db";
import { eq, and, gte, lt, ne, asc, desc } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";

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

const INBOX_RE =
  /\b(inbox|caixa\s*de\s*entrada)\b|mensagen[s]?\s*(pendente|para\s*revisar)|o\s*que\s*(tem|há|ha|está|esta)\s*no\s*(inbox|caixa)|revisão\s*pendente/i;

const TASKS_RE =
  /quai?s?\s*tarefa[s]?|tarefa[s]?\s*(aberta[s]?|pendente[s]?)|lista\s*(de\s*)?tarefa[s]?|o\s*que\s*(está|esta|tem)\s*(pra|para)\s*fazer|afazeres?|pend[eê]ncia[s]?/i;

const TOMORROW_RE = /\b(amanhã|amanha)\b/i;
const TODAY_RE = /\bhoje\b/i;
const WEEK_RE = /(essa|esta|próxima|proxima)\s*semana|(semana\s*que\s*vem)|próximos\s*dias/i;

const QUESTION_MARKER_RE =
  /(\?$|^(o\s*(que|q)\b|qual\b|quai?s?\b|me\s*(diz|conta|fala|mostra)\b|minha?\s*agenda|meu\s*dia|o\s*que\s*(tenho|tem)\b|tenho\b))/i;

export function detectQuestionKeyword(text: string): QuestionType | null {
  const t = text.trim();

  if (INBOX_RE.test(t)) return "inbox_pending";
  if (TASKS_RE.test(t)) return "tasks_open";

  // "agenda [timeframe]" is a common pt-BR shorthand for "o que tenho [timeframe]?"
  // e.g. "agenda de amanhã", "agenda desta semana", "agenda hoje"
  if (/\bagenda\b/i.test(t)) {
    if (TOMORROW_RE.test(t)) return "agenda_tomorrow";
    if (TODAY_RE.test(t)) return "agenda_today";
    if (WEEK_RE.test(t)) return "agenda_week";
    // bare "agenda" with no time context defaults to tomorrow (most useful)
    return "agenda_tomorrow";
  }

  const hasQuestion = QUESTION_MARKER_RE.test(t);
  if (!hasQuestion) return null;

  if (TOMORROW_RE.test(t)) return "agenda_tomorrow";
  if (TODAY_RE.test(t)) return "agenda_today";
  if (WEEK_RE.test(t)) return "agenda_week";

  if (/\b(evento[s]?|compromisso[s]?|o\s*que\s*(tenho|tem))\b/i.test(t)) {
    return "agenda_tomorrow";
  }

  return null;
}

// ── LLM-based fallback detection ─────────────────────────────────────────────

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

async function detectWithLLM(text: string, log: Logger): Promise<QuestionType | null> {
  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 50,
      messages: [
        { role: "system", content: QA_SYSTEM_PROMPT },
        { role: "user", content: text.substring(0, 200) },
      ],
    });
    const raw = (resp.choices[0]?.message?.content ?? "").trim();
    const json = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    const parsed = JSON.parse(json) as { is_question?: boolean; type?: string };
    if (!parsed.is_question || !parsed.type || parsed.type === "other") return null;
    const valid: QuestionType[] = [
      "agenda_today",
      "agenda_tomorrow",
      "agenda_week",
      "tasks_open",
      "inbox_pending",
    ];
    return valid.includes(parsed.type as QuestionType) ? (parsed.type as QuestionType) : null;
  } catch (err) {
    log.warn({ err }, "wa-qa: LLM classification failed — falling through to ingestion");
    return null;
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
  const items = await db
    .select({
      raw_content: inboxItemsTable.raw_content,
      sender_name: inboxItemsTable.sender_name,
      created_at: inboxItemsTable.created_at,
    })
    .from(inboxItemsTable)
    .where(
      and(
        eq(inboxItemsTable.household_id, householdId),
        eq(inboxItemsTable.status, "ready_for_review"),
      ),
    )
    .orderBy(desc(inboxItemsTable.created_at))
    .limit(5);

  if (items.length === 0) {
    return "📬 Inbox vazio — nenhuma mensagem pendente. 👌";
  }

  const lines: string[] = [`📬 *Inbox pendente* (${items.length})`, ""];

  for (const item of items) {
    const preview = item.raw_content.replace(/\n+/g, " ").substring(0, 55);
    const ellipsis = item.raw_content.length > 55 ? "…" : "";
    const from = item.sender_name ? ` — _${item.sender_name}_` : "";
    lines.push(`• ${preview}${ellipsis}${from}`);
  }

  lines.push("", "Acesse o Vesta para revisar e aprovar.");

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
 */
export async function handleQuestionIntent(
  text: string,
  householdId: number,
  log: Logger,
): Promise<QAResult | undefined> {
  // 1. Keyword fast-path — no network call
  let qType = detectQuestionKeyword(text);

  // 2. LLM fallback — only when text has a question signal but keyword missed
  if (!qType) {
    const mightBeQuestion = /\?|^(o\s*(que|q)\b|qual\b|quai?s?\b|me\s*(diz|conta|mostra)\b|tenho\b|tem\b)/i.test(
      text.trim(),
    );
    if (!mightBeQuestion) return undefined;
    qType = await detectWithLLM(text, log);
  }

  if (!qType) return undefined;

  log.info(
    { householdId, qType, preview: text.substring(0, 60) },
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
    return { reply };
  } catch (err) {
    log.error({ err, householdId, qType }, "wa-qa: data resolver failed — falling through");
    return undefined;
  }
}
