import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, onboardingStateTable, membersTable, householdsTable, usersTable } from "@workspace/db";
import { CompleteOnboardingBody } from "@workspace/api-zod";
import { getSessionId, getSession, updateSession } from "../lib/auth";

const router: IRouter = Router();

router.get("/onboarding/state", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const userId = req.user.id;
  const householdId = req.user.household_id ?? 1;

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
});

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

  const {
    display_name,
    composition,
    pain_points,
    whatsapp_phone,
    whatsapp_verified,
    calendar_connected,
  } = parsed.data;

  // Resolve or create the user's household
  let householdId: number = req.user.household_id ?? 0;

  if (!householdId) {
    // Create a dedicated household for this user
    const householdName = display_name
      ? `Casa de ${display_name}`
      : "Minha Casa";
    const [newHousehold] = await db
      .insert(householdsTable)
      .values({ name: householdName, plan: "free" })
      .returning();
    householdId = newHousehold.id;

    // Link the user to their new household
    await db
      .update(usersTable)
      .set({ household_id: householdId })
      .where(eq(usersTable.id, userId));

    // Propagate into the current session so future requests see the correct hid
    const sid = getSessionId(req);
    if (sid) {
      const session = await getSession(sid);
      if (session) {
        await updateSession(sid, {
          ...session,
          user: { ...session.user, household_id: householdId },
        });
      }
    }
  }

  await db
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

  const memberName =
    display_name ?? req.user.firstName ?? req.user.email ?? "Você";

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
});

export default router;
