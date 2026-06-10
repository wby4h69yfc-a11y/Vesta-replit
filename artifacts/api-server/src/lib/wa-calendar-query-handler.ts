/**
 * wa-calendar-query-handler.ts
 *
 * Handles calendar queries from household admins via WhatsApp.
 * Examples: "O que tenho amanhã?", "Minha agenda de quinta", "Tem algo essa semana?",
 *           "Que horas é a reunião do colégio?"
 *
 * Flow:
 *   1. Regex pre-filter (isCalendarQuery) — cheap check before any LLM call
 *   2. Background Google Calendar sync — fire-and-forget if GCal connected and stale
 *   3. LLM date parsing (parseCalendarQueryIntent) — resolves arbitrary date references
 *   4. DB query + formatted reply (with location when available)
 *
 * Read-only: no inbox items are created. Returns early from the message processor.
 * Works in both DM and group chat (caller strips /vesta prefix for group messages).
 *
 * Security: caller MUST verify senderIsAdmin === true before calling.
 * All DB reads and background sync are scoped to the caller's householdId.
 */

import type { Logger } from "pino";
import { db } from "@workspace/db";
import { calendarEventsTable, googleTokensTable, usersTable } from "@workspace/db";
import { eq, and, gte, lt, max } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import { syncHouseholdGoogleCalendar } from "./google-calendar-sync";

// ── Regex pre-filter ──────────────────────────────────────────────────────────
//
// Matches messages that are likely calendar queries.  Conservative enough to
// avoid false positives on mutation commands ("cancela", "cria", …), broad
// enough to catch day-name references ("quinta", "sábado") and time questions.
//
// The filter is intentionally cheap — the LLM call (step 3) is the
// authoritative parser.

const CALENDAR_QUERY_RE =
  /\b(agenda|amanhã|amanha|semana|quando|que\s+hora[s]?|horário|compromisso[s]?|evento[s]?|segunda[\-\s]?feira|terça[\-\s]?feira|terca[\-\s]?feira|quarta[\-\s]?feira|quinta[\-\s]?feira|sexta[\-\s]?feira|sábado|sabado|domingo)\b|\bo\s*que\s*(tenho|tem)\b|\btem\s*algo\b|\btenho\s*(algo|alguma?\s*coisa)?\s+(hoje|amanhã|amanha|semana)/i;

export function isCalendarQuery(text: string): boolean {
  return CALENDAR_QUERY_RE.test(text.trim());
}

// ── BRT helpers ───────────────────────────────────────────────────────────────

/** Returns the current wall-clock date/time shifted to BRT (UTC-3). */
function brtNow(): Date {
  return new Date(Date.now() - 3 * 60 * 60 * 1000);
}

/** Returns UTC start/end of the BRT day that is `daysOffset` days from today. */
function brtDayBounds(daysOffset: number): { start: Date; end: Date } {
  const now = brtNow();
  // midnight of the target BRT day expressed in UTC
  const midnightBrt = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + daysOffset,
  );
  const start = new Date(midnightBrt + 3 * 60 * 60 * 1000);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

// ── LLM date parser ───────────────────────────────────────────────────────────

interface CalendarQueryIntent {
  /** ISO-8601 start of the requested period (UTC). */
  dateFrom: string;
  /** ISO-8601 exclusive end of the requested period (UTC). */
  dateTo: string;
  /** Optional keywords to filter events by title/description. */
  keywords?: string[];
}

const DOW_PT: Record<number, string> = {
  0: "domingo",
  1: "segunda-feira",
  2: "terça-feira",
  3: "quarta-feira",
  4: "quinta-feira",
  5: "sexta-feira",
  6: "sábado",
};

async function parseCalendarQueryIntent(
  text: string,
  log: Logger,
): Promise<CalendarQueryIntent | null> {
  const brt = brtNow();
  const todayStr = `${brt.getUTCFullYear()}-${String(brt.getUTCMonth() + 1).padStart(2, "0")}-${String(brt.getUTCDate()).padStart(2, "0")}`;
  const todayDow = DOW_PT[brt.getUTCDay()] ?? "segunda-feira";

  const systemPrompt = `Você é um parser de datas para o assistente doméstico Vesta.
Hoje é ${todayStr} (${todayDow}, horário de Brasília, UTC-3).
Analise a mensagem e retorne APENAS JSON sem markdown:
{
  "dateFrom": "YYYY-MM-DDTHH:mm:ssZ",
  "dateTo": "YYYY-MM-DDTHH:mm:ssZ",
  "keywords": ["palavra1"]
}
Regras:
- Expresse datas em UTC (adicione 3h aos horários BRT).
- "amanhã" = dia seguinte (00h00 a 23h59 BRT → equivalente UTC).
- "hoje" = dia atual (00h00 a 23h59 BRT → equivalente UTC).
- "essa semana" / "esta semana" = de hoje até 7 dias (fim exclusivo).
- "próxima semana" = de segunda-feira da semana que vem a domingo seguinte.
- Nome de dia ("quinta", "sábado" etc.) = o próximo dia com esse nome, incluindo hoje se for esse dia.
- "keywords": inclua APENAS quando o usuário descreve um evento específico (ex: "reunião do colégio" → ["reunião","colégio"]). Deixe como array vazio [] para consultas genéricas de período.
- dateFrom e dateTo devem cobrir o dia inteiro quando for consulta de um único dia.
Responda APENAS com o JSON, sem markdown nem texto adicional.`;

  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 150,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text.substring(0, 200) },
      ],
    });

    const raw = (resp.choices[0]?.message?.content ?? "").trim();
    const json = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    const parsed = JSON.parse(json) as Partial<CalendarQueryIntent> & { keywords?: string[] };

    if (!parsed.dateFrom || !parsed.dateTo) {
      log.warn({ raw }, "wa-calendar-query: LLM returned incomplete date range");
      return null;
    }

    const from = new Date(parsed.dateFrom);
    const to = new Date(parsed.dateTo);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      log.warn({ raw }, "wa-calendar-query: LLM returned invalid dates");
      return null;
    }

    return {
      dateFrom: from.toISOString(),
      dateTo: to.toISOString(),
      keywords: (parsed.keywords ?? []).filter(
        (k: unknown) => typeof k === "string" && (k as string).length > 1,
      ),
    };
  } catch (err) {
    log.warn({ err }, "wa-calendar-query: LLM parse failed");
    return null;
  }
}

// ── Reply formatter ───────────────────────────────────────────────────────────

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
  outros: "📋",
};

function catEmoji(category: string | null | undefined): string {
  return CATEGORY_EMOJI[category ?? ""] ?? "📋";
}

function formatTimeBRT(utc: Date): string {
  const brt = new Date(utc.getTime() - 3 * 60 * 60 * 1000);
  const h = brt.getUTCHours().toString().padStart(2, "0");
  const m = brt.getUTCMinutes();
  return m === 0 ? `${h}h` : `${h}h${m.toString().padStart(2, "0")}`;
}

function formatDateBRT(utc: Date): string {
  const brt = new Date(utc.getTime() - 3 * 60 * 60 * 1000);
  const days = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  const dow = days[brt.getUTCDay()]!;
  const d = brt.getUTCDate().toString().padStart(2, "0");
  const m = (brt.getUTCMonth() + 1).toString().padStart(2, "0");
  return `${dow}, ${d}/${m}`;
}

async function queryAndFormat(
  householdId: number,
  dateFrom: string,
  dateTo: string,
  keywords: string[],
  log: Logger,
): Promise<string> {
  const from = new Date(dateFrom);
  const to = new Date(dateTo);

  const events = await db
    .select({
      title: calendarEventsTable.title,
      start_at: calendarEventsTable.start_at,
      end_at: calendarEventsTable.end_at,
      all_day: calendarEventsTable.all_day,
      category: calendarEventsTable.category,
      notes: calendarEventsTable.notes,
      location: calendarEventsTable.location,
    })
    .from(calendarEventsTable)
    .where(
      and(
        eq(calendarEventsTable.household_id, householdId),
        gte(calendarEventsTable.start_at, from),
        lt(calendarEventsTable.start_at, to),
      ),
    )
    .orderBy(calendarEventsTable.start_at)
    .limit(15);

  // Apply keyword filter when the user named a specific event.
  let filtered = events;
  if (keywords.length > 0) {
    const kwLower = keywords.map((k) => k.toLowerCase());
    const matched = events.filter((ev) =>
      kwLower.some(
        (kw) =>
          ev.title.toLowerCase().includes(kw) ||
          (ev.notes?.toLowerCase().includes(kw) ?? false) ||
          (ev.location?.toLowerCase().includes(kw) ?? false),
      ),
    );
    // If keyword filter eliminates everything, fall back to full unfiltered list
    // (keywords may have been context words rather than search terms).
    if (matched.length > 0) filtered = matched;
  }

  // Build a human-readable label for the date range header.
  const brtFrom = new Date(from.getTime() - 3 * 60 * 60 * 1000);
  const brtTo = new Date(to.getTime() - 3 * 60 * 60 * 1000 - 1); // inclusive end
  const diffDays = Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
  const singleDay = diffDays <= 1;

  const dateLabel = singleDay
    ? formatDateBRT(from)
    : `${brtFrom.getUTCDate().toString().padStart(2, "0")}/${(brtFrom.getUTCMonth() + 1).toString().padStart(2, "0")} – ${brtTo.getUTCDate().toString().padStart(2, "0")}/${(brtTo.getUTCMonth() + 1).toString().padStart(2, "0")}`;

  if (filtered.length === 0) {
    return `📅 Agenda limpa para ${dateLabel} 🎉`;
  }

  const lines: string[] = [
    singleDay ? `📅 *Agenda de ${dateLabel}*` : `📅 *Agenda: ${dateLabel}*`,
    "",
  ];

  for (const ev of filtered) {
    const timePart = ev.all_day ? "dia todo" : formatTimeBRT(ev.start_at);
    const endPart = ev.end_at && !ev.all_day ? `–${formatTimeBRT(ev.end_at)}` : "";
    const datePart = singleDay ? "" : ` — ${formatDateBRT(ev.start_at)}`;

    let line = `• ${catEmoji(ev.category)} *${ev.title}*${datePart} — ${timePart}${endPart}`;
    if (ev.location) {
      line += `\n  📍 ${ev.location}`;
    }
    lines.push(line);
  }

  if (events.length === 15) {
    lines.push("", "_Exibindo os primeiros 15 eventos. Abra o Vesta para ver todos._");
  }

  return lines.join("\n");
}

// ── Background Google Calendar sync ──────────────────────────────────────────
//
// If any user in this household has Google Calendar connected and the last sync
// was more than 15 minutes ago, we kick off a sync via the shared
// google-calendar-sync lib — same logic used by the HTTP sync route.
// We do NOT await the result; the reply is sent from already-cached local data.

const GCAL_STALE_MS = 15 * 60 * 1000;

async function triggerBackgroundGCalSync(
  householdId: number,
  log: Logger,
): Promise<void> {
  try {
    // Find the first user in this household who has a Google token.
    const [connected] = await db
      .select({ userId: usersTable.id })
      .from(usersTable)
      .innerJoin(googleTokensTable, eq(googleTokensTable.user_id, usersTable.id))
      .where(eq(usersTable.household_id, householdId))
      .limit(1);

    if (!connected) return;

    // Check freshness by max updated_at of google-sourced events for this household.
    const [latestSync] = await db
      .select({ lastAt: max(calendarEventsTable.updated_at) })
      .from(calendarEventsTable)
      .where(
        and(
          eq(calendarEventsTable.household_id, householdId),
          eq(calendarEventsTable.source, "google"),
        ),
      );

    const lastAt = latestSync?.lastAt;
    if (lastAt && Date.now() - lastAt.getTime() < GCAL_STALE_MS) {
      log.info({ householdId }, "wa-calendar-query: GCal data is fresh, skipping background sync");
      return;
    }

    log.info(
      { householdId, userId: connected.userId },
      "wa-calendar-query: triggering background GCal sync",
    );

    // Use the shared lib — same upsert logic as the HTTP sync route.
    await syncHouseholdGoogleCalendar(connected.userId, householdId, log);
  } catch (err) {
    // Non-fatal — the calendar query continues with locally-cached data.
    log.warn({ err, householdId }, "wa-calendar-query: background GCal sync failed (non-fatal)");
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Handles a calendar query from a household admin sent via WhatsApp.
 *
 * Returns `{ reply: string }` when the message is a recognised calendar query,
 * or `null` when the regex pre-filter determines it is not calendar-related
 * (caller should fall through to normal ingestion).
 *
 * Security: caller MUST verify senderIsAdmin === true before calling this.
 * All DB reads are scoped to the caller's `householdId`.
 */
export async function handleCalendarQueryIntent(
  text: string,
  householdId: number,
  log: Logger,
): Promise<{ reply: string } | null> {
  if (!isCalendarQuery(text)) return null;

  // Kick off background GCal sync — result is not awaited.
  void triggerBackgroundGCalSync(householdId, log);

  // Use LLM to resolve the date range and optional event keywords.
  const intent = await parseCalendarQueryIntent(text, log);

  if (!intent) {
    // LLM parse failed — fall back to today as a safe default.
    log.warn({ householdId }, "wa-calendar-query: date parse failed, falling back to today");
    const today = brtDayBounds(0);
    const reply = await queryAndFormat(
      householdId,
      today.start.toISOString(),
      today.end.toISOString(),
      [],
      log,
    );
    return { reply };
  }

  const reply = await queryAndFormat(
    householdId,
    intent.dateFrom,
    intent.dateTo,
    intent.keywords ?? [],
    log,
  );

  log.info(
    {
      householdId,
      dateFrom: intent.dateFrom,
      dateTo: intent.dateTo,
      keywordCount: intent.keywords?.length ?? 0,
    },
    "wa-calendar-query: calendar query answered",
  );

  return { reply };
}
