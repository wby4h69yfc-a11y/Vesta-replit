import { db } from "@workspace/db";
import { contactsTable, auditLogTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

export type RatingKeyword = "bom" | "ok" | "ruim" | "no_show";
export type ReliabilityStatus = "preferred" | "backup" | "avoid" | "untested";

export const VALID_RATINGS: RatingKeyword[] = ["bom", "ok", "ruim", "no_show"];
export const VALID_RELIABILITY: ReliabilityStatus[] = ["preferred", "backup", "avoid", "untested"];

export interface ApplyRatingResult {
  contact: typeof contactsTable.$inferSelect;
  suggest_upgrade: boolean;
  /** True when admin should be prompted to confirm marking provider as "avoid" */
  suggest_avoid: boolean;
}

/**
 * Apply a provider rating to a contact row.
 * Business rules:
 *   bom     → household_rating = min(5, prev+1), last_used_at=now; two consecutive bom → suggest upgrade
 *   ok      → last_used_at=now, neutral
 *   ruim    → reliability_status=avoid
 *   no_show → no_show_count++; ≥2 no-shows → reliability_status=avoid
 *
 * Writes to audit_log in all cases.
 * Returns null if the contact is not found in the given household.
 */
export async function applyContactRating(
  contactId: number,
  householdId: number,
  rating: RatingKeyword,
  actorLabel: string,
): Promise<ApplyRatingResult | null> {
  const [current] = await db
    .select()
    .from(contactsTable)
    .where(and(eq(contactsTable.id, contactId), eq(contactsTable.household_id, householdId)));

  if (!current) return null;

  const now = new Date();
  const prevRating = current.last_rating as RatingKeyword | null;
  const prevNoShows = current.no_show_count ?? 0;

  let reliabilityStatus: ReliabilityStatus = (current.reliability_status ?? "untested") as ReliabilityStatus;
  let householdRating = current.household_rating ?? null;
  let noShowCount = prevNoShows;
  let lastUsedAt = current.last_used_at;
  let suggestUpgrade = false;
  let suggestAvoid = false;

  if (rating === "bom") {
    householdRating = Math.min(5, (householdRating ?? 3) + 1);
    lastUsedAt = now;
    if (prevRating === "bom" && reliabilityStatus !== "preferred") {
      suggestUpgrade = true;
    }
  } else if (rating === "ok") {
    lastUsedAt = now;
  } else if (rating === "ruim") {
    // Do NOT auto-set avoid — return suggest_avoid so the caller can prompt for confirmation.
    lastUsedAt = now;
    suggestAvoid = true;
  } else if (rating === "no_show") {
    noShowCount = prevNoShows + 1;
    if (noShowCount >= 2) {
      // Do NOT auto-set avoid — return suggest_avoid so the caller can prompt for confirmation.
      suggestAvoid = true;
    }
  }

  const [updated] = await db
    .update(contactsTable)
    .set({
      reliability_status: reliabilityStatus,
      household_rating: householdRating,
      no_show_count: noShowCount,
      last_used_at: lastUsedAt,
      last_rating: rating,
    })
    .where(and(eq(contactsTable.id, contactId), eq(contactsTable.household_id, householdId)))
    .returning();

  await db.insert(auditLogTable).values({
    household_id: householdId,
    action: "contact_rated",
    actor: actorLabel,
    action_type: "updated",
    category: "contacts",
    description: `Provider "${current.name}" rated "${rating}". Status: ${reliabilityStatus}. No-shows: ${noShowCount}.`,
    metadata: {
      contact_id: contactId,
      contact_name: current.name,
      rating,
      reliability_status: reliabilityStatus,
      no_show_count: noShowCount,
      household_rating: householdRating,
    },
  });

  return { contact: updated, suggest_upgrade: suggestUpgrade, suggest_avoid: suggestAvoid };
}
