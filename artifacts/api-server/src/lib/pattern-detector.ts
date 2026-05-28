import { db } from "@workspace/db";
import { suggestedActionsTable, patternObservationsTable, householdsTable } from "@workspace/db";
import { eq, gte, sql } from "drizzle-orm";
import { logger } from "./logger";

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

function buildDescription(category: string, type: string, dayOfWeek: number): string {
  const catLabel = CATEGORY_LABELS[category] ?? category;
  const typeLabel = TYPE_LABELS[type] ?? type;
  const dayLabel = DAYS_PT[dayOfWeek] ?? `dia ${dayOfWeek}`;
  return `${catLabel}: ${typeLabel} às ${dayLabel}`;
}

function buildPatternKey(category: string, type: string, dayOfWeek: number): string {
  return `${category}_${type}_dow${dayOfWeek}`;
}

export async function detectPatternsForHousehold(householdId: number): Promise<void> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);

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

  const grouped = new Map<string, { category: string; type: string; dayOfWeek: number; count: number }>();

  for (const action of actions) {
    let dayOfWeek: number | null = null;
    if (action.datetime) {
      const parsed = new Date(action.datetime);
      if (!isNaN(parsed.getTime())) {
        dayOfWeek = parsed.getDay();
      }
    }
    if (dayOfWeek === null) continue;

    const key = buildPatternKey(action.category, action.type, dayOfWeek);
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      grouped.set(key, { category: action.category, type: action.type, dayOfWeek, count: 1 });
    }
  }

  let upserted = 0;
  for (const [key, { category, type, dayOfWeek, count }] of grouped.entries()) {
    if (count < 3) continue;

    const description = buildDescription(category, type, dayOfWeek);
    const confidence = Math.min(0.5 + (count - 3) * 0.1, 0.95);
    const status = count >= 3 ? "threshold_met" : "accumulating";

    await db
      .insert(patternObservationsTable)
      .values({
        household_id: householdId,
        pattern_key: key,
        type: `${category}_${type}`,
        description,
        occurrences: count,
        confidence,
        status,
        evidence: JSON.stringify({ category, type, day_of_week: dayOfWeek, count }),
      })
      .onConflictDoUpdate({
        target: [patternObservationsTable.household_id, patternObservationsTable.pattern_key],
        set: {
          occurrences: count,
          confidence,
          status,
          description,
          evidence: JSON.stringify({ category, type, day_of_week: dayOfWeek, count }),
          updated_at: new Date(),
        },
      });

    upserted += 1;
  }

  if (upserted > 0) {
    logger.info({ householdId, upserted }, "Pattern detector: patterns upserted");
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
