import { Router } from "express";
import { db } from "@workspace/db";
import { contactsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

router.get("/contacts", async (req, res) => {
  try {
    const { category } = req.query as { category?: string };

    const contacts = category
      ? await db.select().from(contactsTable).where(eq(contactsTable.category, category)).orderBy(contactsTable.name)
      : await db.select().from(contactsTable).orderBy(contactsTable.name);

    res.json(contacts);
  } catch (err) {
    req.log.error({ err }, "Failed to list contacts");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/contacts", async (req, res) => {
  try {
    const { name, phone, category, aliases, notes } = req.body;

    if (!name || !category) return res.status(400).json({ error: "name and category are required" });

    const [contact] = await db
      .insert(contactsTable)
      .values({ name, phone: phone ?? null, category, aliases: aliases ?? [], notes: notes ?? null })
      .returning();

    res.status(201).json(contact);
  } catch (err) {
    req.log.error({ err }, "Failed to create contact");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/contacts/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, phone, category, aliases, notes } = req.body;

    const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, id));
    if (!contact) return res.status(404).json({ error: "Not found" });

    const [updated] = await db
      .update(contactsTable)
      .set({
        name: name ?? contact.name,
        phone: phone !== undefined ? phone : contact.phone,
        category: category ?? contact.category,
        aliases: aliases ?? contact.aliases,
        notes: notes !== undefined ? notes : contact.notes,
      })
      .where(eq(contactsTable.id, id))
      .returning();

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update contact");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/contacts/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await db.delete(contactsTable).where(eq(contactsTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete contact");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
