/**
 * Pattern Detector
 *
 * Analyses a household's recent classified messages and inbox history to
 * identify recurring behaviours, then upserts rows into pattern_observations.
 *
 * Two pattern types are detected:
 *
 *   temporal   — same (category, action_type, day_of_week) appears ≥ THRESHOLD
 *                times in the last LOOKBACK_DAYS days from approved/auto_handled
 *                suggested_actions.
 *
 *   frequent_sender — the same named sender has sent ≥ THRESHOLD inbox items
 *                     in the last LOOKBACK_DAYS days.
 *
 * Guard rules:
 *   - Patterns that the user already accepted ("rule_created") or dismissed
 *     ("dismissed") are never overwritten — the occurrence count and confidence
 *     are still updated so they are fresh if the user ever wants to revisit, but
 *     the status is preserved.
 *   - A pattern is raised to "suggested" only when it first crosses THRESHOLD.
 *     Below-threshold patterns stay "accumulating".
 */

import { db } from "@workspace/db";
import { suggestedActionsTable, patternObservationsTable, householdsTable, inboxItemsTable } from "@workspace/db";
import { eq, gte, sql, and, isNotNull } from "drizzle-orm";
import { logger } from "./logger";

/** Minimum number of occurrences before a pattern is surfaced to the user. */
const THRESHOLD = 3;

/** How far back (in days) to look when counting occurrences. */
const LOOKBACK_DAYS = 30;

const DAYS_PT = [
  "domingos",
  "segundas-feiras",
  "terças-feiras",
  "quartas-feiras",
  "quintas-feiras",
  "sextas-feiras",
  "sábados",
] as const;

const CATEGORY_LABELS: Record<string, string> = {
  escola: "Escola",
  saude: "Saúde",
  casa: "Casa",
  social: "Social",
  logistica: "Logística",
  refeicoes: "Refeições",
  servicos: "Serviços",
  outros: "Outros",
};

const TYPE_LABELS: Record<string, string> = {
  event: "evento",
  task: "tarefa",
  reminder: "lembrete",
  fyi: "aviso",
};

function cutoffDate(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function temporalKey(category: string, type: string, dayOfWeek: number): string {
  return `${category}_${type}_dow${dayOfWeek}`;
}

function temporalDescription(category: string, type: string, dayOfWeek: number): string {
  const catLabel = CATEGORY_LABELS[category] ?? category;
  const typeLabel = TYPE_LABELS[type] ?? type;
  const dayLabel = DAYS_PT[dayOfWeek] ?? `dia ${dayOfWeek}`;
  return `${catLabel}: ${typeLabel} às ${dayLabel}`;
}

function senderKey(senderName: string): string {
  // Normalise: lowercase, collapse whitespace, strip non-alphanum for the key
  const norm = senderName.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
  return `frequent_sender_${norm || "unknown"}`;
}

function senderDescription(senderName: string): string {
  return `Mensagens frequentes de ${senderName}`;
}

function confidenceFromCount(count: number): number {
  return Math.min(0.5 + (count - THRESHOLD) * 0.1, 0.95);
}

function statusFromCount(count: number): string {
  return count >= THRESHOLD ? "suggested" : "accumulating";
}

/**
 * Upsert a single pattern observation row.
 *
 * Preserves existing "dismissed" / "rule_created" status so that user decisions
 * are never silently overwritten by the background detector.
 */
async function upsertPattern(opts: {
  householdId: number;
  key: string;
  type: string;
  description: string;
  occurrences: number;
  confidence: number;
  status: string;
  evidence: string;
}): Promise<void> {
  await db
    .insert(patternObservationsTable)
    .values({
      household_id: opts.householdId,
      pattern_key: opts.key,
      type: opts.type,
      description: opts.description,
      occurrences: opts.occurrences,
      confidence: opts.confidence,
      status: opts.status,
      evidence: opts.evidence,
    })
    .onConflictDoUpdate({
      target: [patternObservationsTable.household_id, patternObservationsTable.pattern_key],
      set: {
        occurrences: opts.occurrences,
        confidence: opts.confidence,
        description: opts.description,
        evidence: opts.evidence,
        // Preserve terminal user decisions — only update status when the row is
        // still in a system-managed state.
        status: sql`CASE
          WHEN ${patternObservationsTable.status} IN ('rule_created', 'dismissed')
            THEN ${patternObservationsTable.status}
          ELSE ${opts.status}::text
        END`,
        updated_at: new Date(),
      },
    });
}

// ── Temporal patterns ────────────────────────────────────────────────────────

async function detectTemporalPatterns(householdId: number): Promise<number> {
  const cutoff = cutoffDate(LOOKBACK_DAYS);

  const actions = await db
    .select({
      category: suggestedActionsTable.category,
      type: suggestedActionsTable.type,
      datetime: suggestedActionsTable.datetime,
    })
    .from(suggestedActionsTable)
    .where(
      sql`${suggestedActionsTable.household_id} = ${householdId}
        AND ${suggestedActionsTable.created_at} >= ${cutoff}
        AND ${suggestedActionsTable.status} IN ('approved', 'auto_handled')`,
    );

  const grouped = new Map<
    string,
    { category: string; type: string; dayOfWeek: number; count: number }
  >();

  for (const action of actions) {
    if (!action.datetime) continue;
    const parsed = new Date(action.datetime);
    if (isNaN(parsed.getTime())) continue;
    const dayOfWeek = parsed.getDay();
    const key = temporalKey(action.category, action.type, dayOfWeek);
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      grouped.set(key, { category: action.category, type: action.type, dayOfWeek, count: 1 });
    }
  }

  let upserted = 0;
  for (const [key, { category, type, dayOfWeek, count }] of grouped.entries()) {
    await upsertPattern({
      householdId,
      key,
      type: `${category}_${type}`,
      description: temporalDescription(category, type, dayOfWeek),
      occurrences: count,
      confidence: confidenceFromCount(count),
      status: statusFromCount(count),
      evidence: JSON.stringify({ category, type, day_of_week: dayOfWeek, count }),
    });
    upserted++;
  }

  return upserted;
}

// ── Sender frequency patterns ─────────────────────────────────────────────────

async function detectSenderPatterns(householdId: number): Promise<number> {
  const cutoff = cutoffDate(LOOKBACK_DAYS);

  const rows = await db
    .select({ sender_name: inboxItemsTable.sender_name })
    .from(inboxItemsTable)
    .where(
      and(
        eq(inboxItemsTable.household_id, householdId),
        gte(inboxItemsTable.created_at, cutoff),
        isNotNull(inboxItemsTable.sender_name),
      ),
    );

  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.sender_name) continue;
    counts.set(row.sender_name, (counts.get(row.sender_name) ?? 0) + 1);
  }

  let upserted = 0;
  for (const [name, count] of counts.entries()) {
    await upsertPattern({
      householdId,
      key: senderKey(name),
      type: "frequent_sender",
      description: senderDescription(name),
      occurrences: count,
      confidence: confidenceFromCount(count),
      status: statusFromCount(count),
      evidence: JSON.stringify({ sender_name: name, count }),
    });
    upserted++;
  }

  return upserted;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function detectPatternsForHousehold(householdId: number): Promise<void> {
  const [temporal, senders] = await Promise.all([
    detectTemporalPatterns(householdId),
    detectSenderPatterns(householdId),
  ]);

  if (temporal + senders > 0) {
    logger.info({ householdId, temporal, senders }, "Pattern detector: patterns upserted");
  }
}

export async function detectPatternsForAllHouseholds(): Promise<void> {
  try {
    const households = await db
      .select({ id: householdsTable.id })
      .from(householdsTable);

    for (const household of households) {
      try {
        await detectPatternsForHousehold(household.id);
      } catch (err) {
        logger.error({ err, householdId: household.id }, "Pattern detector: error for household");
      }
    }
  } catch (err) {
    logger.error({ err }, "Pattern detector: failed to list households");
  }
}
