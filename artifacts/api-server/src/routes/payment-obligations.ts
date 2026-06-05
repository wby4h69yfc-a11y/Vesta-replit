import { Router } from "express";
import { db } from "@workspace/db";
import { paymentObligationsTable, membersTable } from "@workspace/db";
import { eq, and, isNotNull } from "drizzle-orm";
import { getHouseholdId } from "../lib/tenant";

const router = Router();

router.get("/payment-obligations", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const { status } = req.query as { status?: string };

    const conditions = [eq(paymentObligationsTable.household_id, hid)];
    if (status) conditions.push(eq(paymentObligationsTable.status, status));

    const obligations = await db
      .select()
      .from(paymentObligationsTable)
      .where(and(...conditions))
      .orderBy(paymentObligationsTable.created_at);

    res.json(obligations);
  } catch (err) {
    req.log.error({ err }, "Failed to list payment obligations");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/payment-obligations/reimbursements", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const userId = (req.user as { id: string }).id;

    const myMember = await db
      .select({ id: membersTable.id })
      .from(membersTable)
      .where(and(eq(membersTable.household_id, hid), eq(membersTable.user_id, userId)))
      .limit(1);

    const myMemberId = myMember[0]?.id;

    const all = await db
      .select()
      .from(paymentObligationsTable)
      .where(
        and(
          eq(paymentObligationsTable.household_id, hid),
          isNotNull(paymentObligationsTable.reimbursement_owed_by_id),
        ),
      )
      .orderBy(paymentObligationsTable.created_at);

    const pendingReimbursements = all.filter((o) => o.status !== "paid" && o.status !== "cancelled");

    const owedByMe = myMemberId
      ? pendingReimbursements.filter((o) => o.reimbursement_owed_by_id === myMemberId)
      : [];

    const owedToMe = myMemberId
      ? pendingReimbursements.filter((o) => o.owner_id === myMemberId && o.reimbursement_owed_by_id !== myMemberId)
      : [];

    const allPending = myMemberId ? [] : pendingReimbursements;

    res.json({
      owed_by_me: owedByMe,
      owed_to_me: owedToMe,
      all: allPending,
      has_member: !!myMemberId,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch reimbursements");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/payment-obligations", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const {
      description, recipient, amount_cents, currency, due_date,
      is_recurring, recurrence_pattern, owner_id, paid_by_id,
      reimbursement_owed_by_id, payment_method, source_inbox_id,
    } = req.body;

    if (!description) return res.status(400).json({ error: "description is required" });

    const [obligation] = await db
      .insert(paymentObligationsTable)
      .values({
        household_id: hid,
        source_inbox_id: source_inbox_id ?? null,
        description,
        recipient: recipient ?? null,
        amount_cents: amount_cents ?? null,
        currency: currency ?? "BRL",
        due_date: due_date ?? null,
        is_recurring: is_recurring ?? false,
        recurrence_pattern: recurrence_pattern ?? null,
        owner_id: owner_id ?? null,
        paid_by_id: paid_by_id ?? null,
        reimbursement_owed_by_id: reimbursement_owed_by_id ?? null,
        payment_method: payment_method ?? null,
        status: "pending",
      })
      .returning();

    return res.status(201).json(obligation);
  } catch (err) {
    req.log.error({ err }, "Failed to create payment obligation");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/payment-obligations/:id", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const id = parseInt(req.params.id, 10);

    const [existing] = await db
      .select()
      .from(paymentObligationsTable)
      .where(and(eq(paymentObligationsTable.id, id), eq(paymentObligationsTable.household_id, hid)));

    if (!existing) return res.status(404).json({ error: "Not found" });

    const {
      description, recipient, amount_cents, currency, due_date,
      is_recurring, recurrence_pattern, owner_id, paid_by_id,
      reimbursement_owed_by_id, payment_method, status, paid_at,
      proof_url, reimbursement_note,
    } = req.body;

    const [updated] = await db
      .update(paymentObligationsTable)
      .set({
        description:              description              ?? existing.description,
        recipient:                recipient               !== undefined ? recipient               : existing.recipient,
        amount_cents:             amount_cents            !== undefined ? amount_cents            : existing.amount_cents,
        currency:                 currency                ?? existing.currency,
        due_date:                 due_date                !== undefined ? due_date                : existing.due_date,
        is_recurring:             is_recurring            !== undefined ? is_recurring            : existing.is_recurring,
        recurrence_pattern:       recurrence_pattern      !== undefined ? recurrence_pattern      : existing.recurrence_pattern,
        owner_id:                 owner_id                !== undefined ? owner_id                : existing.owner_id,
        paid_by_id:               paid_by_id              !== undefined ? paid_by_id              : existing.paid_by_id,
        reimbursement_owed_by_id: reimbursement_owed_by_id !== undefined ? reimbursement_owed_by_id : existing.reimbursement_owed_by_id,
        payment_method:           payment_method          !== undefined ? payment_method          : existing.payment_method,
        status:                   status                  ?? existing.status,
        paid_at:                  paid_at ? new Date(paid_at as string) : existing.paid_at,
        proof_url:                proof_url               !== undefined ? proof_url               : existing.proof_url,
        reimbursement_note:       reimbursement_note      !== undefined ? reimbursement_note      : existing.reimbursement_note,
      })
      .where(and(eq(paymentObligationsTable.id, id), eq(paymentObligationsTable.household_id, hid)))
      .returning();

    return res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update payment obligation");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/payment-obligations/:id", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const id = parseInt(req.params.id, 10);
    await db
      .delete(paymentObligationsTable)
      .where(and(eq(paymentObligationsTable.id, id), eq(paymentObligationsTable.household_id, hid)));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete payment obligation");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/payment-obligations/:id/settle", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const id = parseInt(req.params.id, 10);
    const { note } = req.body as { note?: string };

    const [existing] = await db
      .select()
      .from(paymentObligationsTable)
      .where(and(eq(paymentObligationsTable.id, id), eq(paymentObligationsTable.household_id, hid)));

    if (!existing) return res.status(404).json({ error: "Not found" });

    const [updated] = await db
      .update(paymentObligationsTable)
      .set({
        status: "paid",
        paid_at: new Date(),
        reimbursement_note: note ?? existing.reimbursement_note,
      })
      .where(and(eq(paymentObligationsTable.id, id), eq(paymentObligationsTable.household_id, hid)))
      .returning();

    return res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to settle payment obligation");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/payment-obligations/:id/comprovante", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const id = parseInt(req.params.id, 10);
    const { proof_url } = req.body as { proof_url?: string };

    const [existing] = await db
      .select()
      .from(paymentObligationsTable)
      .where(and(eq(paymentObligationsTable.id, id), eq(paymentObligationsTable.household_id, hid)));

    if (!existing) return res.status(404).json({ error: "Not found" });
    if (!proof_url) return res.status(400).json({ error: "proof_url is required" });

    const [updated] = await db
      .update(paymentObligationsTable)
      .set({
        proof_url,
        status: "comprovante_received",
        paid_at: new Date(),
      })
      .where(and(eq(paymentObligationsTable.id, id), eq(paymentObligationsTable.household_id, hid)))
      .returning();

    return res.json({ obligation: updated, ocr_note: "Comprovante registrado com sucesso." });
  } catch (err) {
    req.log.error({ err }, "Failed to attach comprovante");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
