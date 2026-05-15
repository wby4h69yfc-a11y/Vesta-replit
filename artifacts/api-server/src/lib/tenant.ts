import type { Request } from "express";

/**
 * Returns the household ID for the currently authenticated user.
 *
 * Falls back to 1 for backward-compatibility with accounts created before
 * household isolation was introduced (those users have household_id = null
 * in the session). Once every user has completed onboarding the fallback
 * becomes unreachable.
 *
 * requireAuth middleware MUST have run before this is called.
 */
export function getHouseholdId(req: Request): number {
  return req.user?.household_id ?? 1;
}
