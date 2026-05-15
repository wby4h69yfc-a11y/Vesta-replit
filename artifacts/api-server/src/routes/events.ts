import { Router } from "express";
import { db } from "@workspace/db";
import { calendarEventsTable } from "@workspace/db";
import { eq, and, gte, lte } from "drizzle-orm";
import { getHouseholdId } from "../lib/tenant";

const router = Router();

router.get("/events", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const { from, to, category } = req.query as { from?: string; to?: string; category?: string };

    const conditions = [eq(calendarEventsTable.household_id, hid)];
    if (from) conditions.push(gte(calendarEventsTable.start_at, new Date(from)));
    if (to) conditions.push(lte(calendarEventsTable.start_at, new Date(to)));
    if (category) conditions.push(eq(calendarEventsTable.category, category));

    const events = await db
      .select()
      .from(calendarEventsTable)
      .where(and(...conditions))
      .orderBy(calendarEventsTable.start_at);

    res.json(events);
  } catch (err) {
    req.log.error({ err }, "Failed to list events");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/events", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const { title, start_at, end_at, all_day, category, members, notes } = req.body;

    if (!title || !start_at || !category) {
      return res.status(400).json({ error: "title, start_at, and category are required" });
    }

    const [event] = await db
      .insert(calendarEventsTable)
      .values({
        household_id: hid,
        title,
        start_at: new Date(start_at),
        end_at: end_at ? new Date(end_at) : null,
        all_day: all_day ?? false,
        category,
        members: members ?? [],
        source: "manual",
        sync_status: "local",
        notes: notes ?? null,
      })
      .returning();

    res.status(201).json(event);
  } catch (err) {
    req.log.error({ err }, "Failed to create event");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/events/:id", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const id = parseInt(req.params.id, 10);
    const [event] = await db
      .select()
      .from(calendarEventsTable)
      .where(and(eq(calendarEventsTable.id, id), eq(calendarEventsTable.household_id, hid)));

    if (!event) return res.status(404).json({ error: "Not found" });
    res.json(event);
  } catch (err) {
    req.log.error({ err }, "Failed to get event");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/events/:id", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const id = parseInt(req.params.id, 10);
    const { title, start_at, end_at, all_day, category, notes } = req.body;

    const [event] = await db
      .select()
      .from(calendarEventsTable)
      .where(and(eq(calendarEventsTable.id, id), eq(calendarEventsTable.household_id, hid)));
    if (!event) return res.status(404).json({ error: "Not found" });

    const [updated] = await db
      .update(calendarEventsTable)
      .set({
        title: title ?? event.title,
        start_at: start_at ? new Date(start_at) : event.start_at,
        end_at: end_at !== undefined ? (end_at ? new Date(end_at) : null) : event.end_at,
        all_day: all_day ?? event.all_day,
        category: category ?? event.category,
        notes: notes !== undefined ? notes : event.notes,
      })
      .where(and(eq(calendarEventsTable.id, id), eq(calendarEventsTable.household_id, hid)))
      .returning();

    return res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update event");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/events/:id", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const id = parseInt(req.params.id, 10);
    await db
      .delete(calendarEventsTable)
      .where(and(eq(calendarEventsTable.id, id), eq(calendarEventsTable.household_id, hid)));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete event");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
