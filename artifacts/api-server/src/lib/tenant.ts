import type { Request } from "express";

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
