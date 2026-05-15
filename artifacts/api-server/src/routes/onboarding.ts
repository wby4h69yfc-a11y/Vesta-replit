import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, onboardingStateTable, membersTable, householdsTable, usersTable } from "@workspace/db";
import { CompleteOnboardingBody } from "@workspace/api-zod";
import { getHouseholdId } from "../lib/tenant";

const router: IRouter = Router();

/**
 * GET /api/onboarding/state
 *
 * Returns (or creates) the onboarding state record for the current user.
 * requireAuth + requireHousehold middleware guarantee req.user.household_id is set.
 */
router.get("/onboarding/state", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const userId = req.user.id;
    const householdId = getHouseholdId(req);

    let [state] = await db
      .select()
      .from(onboardingStateTable)
      .where(eq(onboardingStateTable.user_id, userId));

    if (!state) {
      [state] = await db
        .insert(onboardingStateTable)
        .values({
          user_id: userId,
          household_id: householdId,
          current_step: 0,
          completed: false,
        })
        .returning();
    }

    res.json({ state });
  } catch (err) {
    req.log.error({ err }, "Failed to get onboarding state");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/onboarding/complete
 *
 * Marks onboarding as complete. Renames the household and creates the
 * primary member record. The household was already created atomically
 * at login time, so no household creation is needed here.
 */
router.post("/onboarding/complete", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const userId = req.user.id;
  const parsed = CompleteOnboardingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  try {
    const {
      display_name,
      composition,
      pain_points,
      whatsapp_phone,
      whatsapp_verified,
      calendar_connected,
    } = parsed.data;

    const householdId = getHouseholdId(req);

    // Rename the household now that we know the user's preferred name
    if (display_name) {
      await db
        .update(householdsTable)
        .set({ name: `Casa de ${display_name}` })
        .where(eq(householdsTable.id, householdId));
    }

    // Mark onboarding complete
    const updated = await db
      .update(onboardingStateTable)
      .set({
        completed: true,
        current_step: 7,
        household_id: householdId,
        composition: composition ?? null,
        pain_points: pain_points ?? [],
        whatsapp_verified: whatsapp_verified ?? false,
        calendar_connected: calendar_connected ?? false,
        updated_at: new Date(),
      })
      .where(eq(onboardingStateTable.user_id, userId));

    if (!updated.rowCount) {
      // No row existed yet — insert it
      await db.insert(onboardingStateTable).values({
        user_id: userId,
        household_id: householdId,
        completed: true,
        current_step: 7,
        composition: composition ?? null,
        pain_points: pain_points ?? [],
        whatsapp_verified: whatsapp_verified ?? false,
        calendar_connected: calendar_connected ?? false,
      });
    }

    const memberName =
      display_name ?? req.user.firstName ?? req.user.email ?? "Você";

    // Create primary member if one doesn't exist yet for this household
    const [existing] = await db
      .select()
      .from(membersTable)
      .where(eq(membersTable.household_id, householdId))
      .limit(1);

    if (!existing) {
      await db.insert(membersTable).values({
        household_id: householdId,
        name: memberName,
        display_name: memberName,
        role: "admin",
        relationship_type: "adult",
        phone: whatsapp_phone ?? null,
      });
    }

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to complete onboarding");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
