import { Router } from "express";
import { db } from "@workspace/db";
import { contactsTable, inboxItemsTable } from "@workspace/db";
import { eq, and, notInArray, sql } from "drizzle-orm";

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

/**
 * GET /api/contacts/whatsapp-senders
 * Returns unique senders from the inbox that are NOT yet saved as contacts.
 * Used by the "Import from inbox" flow in the WhatsApp settings UI.
 */
router.get("/contacts/whatsapp-senders", async (req, res) => {
  try {
    // Get all existing contact names (case-insensitive comparison done in JS)
    const existing = await db.select({ name: contactsTable.name }).from(contactsTable);
    const existingNames = new Set(existing.map((c) => c.name.toLowerCase().trim()));

    // Get all distinct sender_names from inbox (whatsapp + photo sources only)
    const rows = await db
      .selectDistinct({ sender_name: inboxItemsTable.sender_name })
      .from(inboxItemsTable)
      .where(
        sql`${inboxItemsTable.sender_name} IS NOT NULL AND ${inboxItemsTable.source} IN ('whatsapp', 'photo')`,
      );

    const unmatched = rows
      .map((r) => r.sender_name!)
      .filter((name) => !existingNames.has(name.toLowerCase().trim()));

    res.json(unmatched.map((name) => ({ name })));
  } catch (err) {
    req.log.error({ err }, "Failed to list whatsapp senders");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/contacts/bulk
 * Creates multiple contacts in one shot.
 * Body: { contacts: Array<{ name, phone?, category, notes? }> }
 */
router.post("/contacts/bulk", async (req, res) => {
  try {
    const { contacts } = req.body as {
      contacts: Array<{ name: string; phone?: string; category: string; notes?: string }>;
    };

    if (!Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({ error: "contacts array is required" });
    }

    const values = contacts.map((c) => ({
      name: c.name,
      phone: c.phone ?? null,
      category: c.category ?? "outros",
      aliases: [] as string[],
      notes: c.notes ?? null,
      household_id: 1,
    }));

    const created = await db.insert(contactsTable).values(values).returning();
    res.status(201).json(created);
  } catch (err) {
    req.log.error({ err }, "Failed to bulk create contacts");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/contacts/parse-whatsapp-export
 * Parses the text content of a WhatsApp exported chat (.txt) and returns
 * unique senders (name or phone) not already in the contacts list.
 *
 * WhatsApp export line formats (Brazil):
 *   [DD/MM/YYYY, HH:MM:SS] +55 11 99999-9999: text
 *   [DD/MM/YYYY, HH:MM:SS] Nome do Contato: text
 */
router.post("/contacts/parse-whatsapp-export", async (req, res) => {
  try {
    const { text } = req.body as { text?: string };
    if (!text) return res.status(400).json({ error: "text is required" });

    // Matches both date formats used by WhatsApp in Brazil
    // [DD/MM/YYYY, HH:MM:SS] Sender: ...
    // [DD/MM/YYYY HH:MM:SS] Sender: ...
    const lineRe = /^\[[\d/]+[, ]+[\d:]+\]\s+([^:]+):/gm;

    const systemMessages = new Set([
      "Messages and calls are end-to-end encrypted",
      "As mensagens e as chamadas são protegidas com a criptografia",
      "Você entrou",
      "Você saiu",
    ]);

    const seen = new Set<string>();
    const senders: Array<{ name: string; phone: string | null }> = [];

    let match: RegExpExecArray | null;
    while ((match = lineRe.exec(text)) !== null) {
      const raw = match[1].trim();
      if (systemMessages.has(raw)) continue;
      if (seen.has(raw)) continue;
      seen.add(raw);

      // Detect if it looks like a phone number
      const isPhone = /^\+?\d[\d\s\-()]{6,}$/.test(raw);
      senders.push({
        name: isPhone ? raw : raw,
        phone: isPhone ? raw.replace(/\s/g, "") : null,
      });
    }

    // Filter out names already in contacts
    const existing = await db.select({ name: contactsTable.name, phone: contactsTable.phone }).from(contactsTable);
    const existingNames = new Set(existing.map((c) => c.name.toLowerCase().trim()));
    const existingPhones = new Set(
      existing.filter((c) => c.phone).map((c) => c.phone!.replace(/\D/g, "").slice(-8)),
    );

    const unmatched = senders.filter((s) => {
      if (existingNames.has(s.name.toLowerCase().trim())) return false;
      if (s.phone && existingPhones.has(s.phone.replace(/\D/g, "").slice(-8))) return false;
      return true;
    });

    res.json(unmatched);
  } catch (err) {
    req.log.error({ err }, "Failed to parse whatsapp export");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
