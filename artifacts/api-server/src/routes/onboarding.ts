import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, onboardingStateTable, membersTable } from "@workspace/db";
import { CompleteOnboardingBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/onboarding/state", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const userId = req.user.id;

  let [state] = await db
    .select()
    .from(onboardingStateTable)
    .where(eq(onboardingStateTable.user_id, userId));

  if (!state) {
    [state] = await db
      .insert(onboardingStateTable)
      .values({
        user_id: userId,
        household_id: 1,
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

  await db
    .update(onboardingStateTable)
    .set({
      completed: true,
      current_step: 7,
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
    .where(eq(membersTable.household_id, 1))
    .limit(1);

  if (!existing) {
    await db.insert(membersTable).values({
      household_id: 1,
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
