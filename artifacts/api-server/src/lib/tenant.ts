import type { Request } from "express";
import { db, membersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

/**
 * Returns the household ID for the currently authenticated user.
 *
 * Preconditions (enforced by middleware in routes/index.ts):
 *   1. requireAuth  — user is authenticated (req.user is set)
 *   2. requireHousehold — req.user.household_id is a positive integer
 *
 * If either precondition is violated this function throws rather than
 * silently falling back to household 1. Every authenticated user is
 * guaranteed to have a household assigned at login time.
 */
export function getHouseholdId(req: Request): number {
  const hid = req.user?.household_id;
  if (!hid) {
    throw new Error(
      "getHouseholdId: user has no household — requireHousehold must run before this route",
    );
  }
  return hid;
}

/**
 * Returns the household role ("admin" | "member" | "restricted") for the
 * currently authenticated user, or null if no member row is found.
 *
 * Looks up the members table using both user_id and household_id so the result
 * is scoped to the caller's own household and cannot be spoofed via the request
 * body.
 */
export async function getCallerRole(
  req: Request,
): Promise<"admin" | "member" | "restricted" | null> {
  const userId = req.user?.id;
  const hid = req.user?.household_id;
  if (!userId || !hid) return null;
  const [row] = await db
    .select({ role: membersTable.role })
    .from(membersTable)
    .where(and(eq(membersTable.user_id, userId), eq(membersTable.household_id, hid)));
  const r = row?.role;
  if (r === "admin" || r === "member" || r === "restricted") return r;
  return null;
}
