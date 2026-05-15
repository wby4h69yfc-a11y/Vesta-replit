import { Router } from "express";
import { db } from "@workspace/db";
import { householdsTable, membersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getHouseholdId } from "../lib/tenant";

const router = Router();

router.get("/household", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const [household] = await db
      .select()
      .from(householdsTable)
      .where(eq(householdsTable.id, hid));

    if (!household) {
      // Create household for this user if it doesn't exist yet
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
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const { name, location, plan } = req.body;
    const [household] = await db
      .select()
      .from(householdsTable)
      .where(eq(householdsTable.id, hid));

    if (!household) return res.status(404).json({ error: "Not found" });

    const [updated] = await db
      .update(householdsTable)
      .set({
        name: name ?? household.name,
        location: location ?? household.location,
        plan: plan ?? household.plan,
      })
      .where(eq(householdsTable.id, hid))
      .returning();

    return res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update household");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/household/members", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const members = await db
      .select()
      .from(membersTable)
      .where(eq(membersTable.household_id, hid))
      .orderBy(membersTable.created_at);
    res.json(members);
  } catch (err) {
    req.log.error({ err }, "Failed to list members");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
