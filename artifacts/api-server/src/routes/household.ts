import { Router } from "express";
import { db } from "@workspace/db";
import { householdsTable, membersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/household", async (req, res) => {
  try {
    const [household] = await db.select().from(householdsTable).limit(1);

    if (!household) {
      // Create default household if none exists
      const [created] = await db
        .insert(householdsTable)
        .values({ name: "Minha Casa", plan: "free" })
        .returning();
      return res.json(created);
    }

    return res.json(household);
  } catch (err) {
    req.log.error({ err }, "Failed to get household");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/household", async (req, res) => {
  try {
    const { name, location, plan } = req.body;
    const [household] = await db.select().from(householdsTable).limit(1);

    if (!household) return res.status(404).json({ error: "Not found" });

    const [updated] = await db
      .update(householdsTable)
      .set({
        name: name ?? household.name,
        location: location ?? household.location,
        plan: plan ?? household.plan,
      })
      .where(eq(householdsTable.id, household.id))
      .returning();

    return res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update household");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/household/members", async (req, res) => {
  try {
    const members = await db.select().from(membersTable).orderBy(membersTable.created_at);
    res.json(members);
  } catch (err) {
    req.log.error({ err }, "Failed to list members");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
