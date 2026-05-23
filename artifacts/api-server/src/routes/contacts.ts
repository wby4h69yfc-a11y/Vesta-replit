import { Router } from "express";
import { db } from "@workspace/db";
import { contactsTable, inboxItemsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { getHouseholdId } from "../lib/tenant";

const router = Router();


router.get("/contacts", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const { category } = req.query as { category?: string };

    const conditions = [eq(contactsTable.household_id, hid)];
    if (category) conditions.push(eq(contactsTable.category, category));

    const contacts = await db
      .select()
      .from(contactsTable)
      .where(and(...conditions))
      .orderBy(contactsTable.name);

    res.json(contacts);
  } catch (err) {
    req.log.error({ err }, "Failed to list contacts");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/contacts", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const { name, phone, category, aliases, notes } = req.body;

    if (!name || !category) return res.status(400).json({ error: "name and category are required" });

    const [contact] = await db
      .insert(contactsTable)
      .values({ household_id: hid, name, phone: phone ?? null, category, aliases: aliases ?? [], notes: notes ?? null })
      .returning();

    res.status(201).json(contact);
  } catch (err) {
    req.log.error({ err }, "Failed to create contact");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/contacts/:id", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const id = parseInt(req.params.id, 10);
    const { name, phone, category, aliases, notes, consent_status } = req.body as {
      name?: string;
      phone?: string;
      category?: string;
      aliases?: string[];
      notes?: string;
      consent_status?: "not_required" | "pending" | "consented" | "revoked";
    };

    const [contact] = await db
      .select()
      .from(contactsTable)
      .where(and(eq(contactsTable.id, id), eq(contactsTable.household_id, hid)));
    if (!contact) return res.status(404).json({ error: "Not found" });

    // Derive consent timestamps from status transitions.
    const consentGrantedAt =
      consent_status === "consented" && contact.consent_status !== "consented"
        ? new Date()
        : contact.consent_granted_at;
    const consentWithdrawnAt =
      consent_status === "revoked" && contact.consent_status !== "revoked"
        ? new Date()
        : contact.consent_withdrawn_at;

    const [updated] = await db
      .update(contactsTable)
      .set({
        name: name ?? contact.name,
        phone: phone !== undefined ? phone : contact.phone,
        category: category ?? contact.category,
        aliases: aliases ?? contact.aliases,
        notes: notes !== undefined ? notes : contact.notes,
        ...(consent_status !== undefined && {
          consent_status,
          consent_granted_at: consentGrantedAt,
          consent_withdrawn_at: consentWithdrawnAt,
        }),
      })
      .where(and(eq(contactsTable.id, id), eq(contactsTable.household_id, hid)))
      .returning();

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update contact");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/contacts/:id", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const id = parseInt(req.params.id, 10);
    await db
      .delete(contactsTable)
      .where(and(eq(contactsTable.id, id), eq(contactsTable.household_id, hid)));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete contact");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/contacts/whatsapp-senders", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);

    const existing = await db
      .select({ name: contactsTable.name })
      .from(contactsTable)
      .where(eq(contactsTable.household_id, hid));
    const existingNames = new Set(existing.map((c) => c.name.toLowerCase().trim()));

    const rows = await db
      .selectDistinct({ sender_name: inboxItemsTable.sender_name })
      .from(inboxItemsTable)
      .where(
        sql`${inboxItemsTable.household_id} = ${hid} AND ${inboxItemsTable.sender_name} IS NOT NULL AND ${inboxItemsTable.source} IN ('whatsapp', 'photo')`,
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

router.post("/contacts/bulk", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
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
      household_id: hid,
    }));

    const created = await db.insert(contactsTable).values(values).returning();
    res.status(201).json(created);
  } catch (err) {
    req.log.error({ err }, "Failed to bulk create contacts");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/contacts/parse-whatsapp-export", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const { text } = req.body as { text?: string };
    if (!text) return res.status(400).json({ error: "text is required" });

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

      const isPhone = /^\+?\d[\d\s\-()]{6,}$/.test(raw);
      senders.push({
        name: isPhone ? raw : raw,
        phone: isPhone ? raw.replace(/\s/g, "") : null,
      });
    }

    const existing = await db
      .select({ name: contactsTable.name, phone: contactsTable.phone })
      .from(contactsTable)
      .where(eq(contactsTable.household_id, hid));
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
