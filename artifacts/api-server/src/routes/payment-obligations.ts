import { Router } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import { paymentObligationsTable, membersTable, tasksTable } from "@workspace/db";
import { eq, and, isNotNull } from "drizzle-orm";
import { getHouseholdId } from "../lib/tenant";
import { openai } from "@workspace/integrations-openai-ai-server";
import { objectStorageClient } from "../lib/objectStorage";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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
    const id = parseInt(String(req.params.id), 10);

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
    const id = parseInt(String(req.params.id), 10);
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
    const id = parseInt(String(req.params.id), 10);
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

router.post("/payment-obligations/:id/comprovante", upload.single("file"), async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const id = parseInt(String(req.params.id), 10);

    const [existing] = await db
      .select()
      .from(paymentObligationsTable)
      .where(and(eq(paymentObligationsTable.id, id), eq(paymentObligationsTable.household_id, hid)));

    if (!existing) return res.status(404).json({ error: "Not found" });
    if (!req.file) return res.status(400).json({ error: "file is required" });

    // Upload file to object storage (GCS).
    // proof_url: stable API path stored in DB for long-term retrieval.
    // ocrUrl:    short-lived signed URL used only for the vision OCR call.
    let proof_url: string;
    let ocrUrl: string;
    try {
      const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
      if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");
      const objectName = `comprovantes/${hid}/${id}/${Date.now()}-${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const fileRef = objectStorageClient.bucket(bucketId).file(objectName);
      await fileRef.save(req.file.buffer, {
        metadata: { contentType: req.file.mimetype },
      });
      const [signedUrl] = await fileRef.getSignedUrl({
        action: "read",
        expires: Date.now() + 60 * 60 * 1000, // 1h — enough for the OCR call below
      });
      // Stable API path — clients retrieve via GET /api/storage/objects/<objectName>
      proof_url = `/api/storage/objects/${objectName}`;
      ocrUrl = signedUrl;
    } catch (uploadErr) {
      req.log.warn({ uploadErr }, "Object storage upload failed, falling back to base64 for OCR");
      const b64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
      proof_url = b64;
      ocrUrl = b64;
    }

    // OCR-based verification: use GPT-4o vision to extract payment details from the image
    let ocr_note = "Comprovante registrado com sucesso.";
    let ocr_amount_cents: number | null = null;
    try {
      const visionResp = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 256,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Você é um assistente de verificação de comprovantes bancários brasileiros.
Analise a imagem e extraia as seguintes informações em JSON:
{
  "valor": <número em reais, ex: 150.00, ou null>,
  "destinatario": <nome do destinatário ou null>,
  "data": <data no formato YYYY-MM-DD ou null>,
  "metodo": <"pix"|"ted"|"boleto"|"cartao"|"dinheiro"|null>
}
Retorne APENAS o JSON, sem texto adicional.`,
              },
              {
                type: "image_url",
                image_url: { url: ocrUrl, detail: "low" },
              },
            ],
          },
        ],
      });

      const raw = visionResp.choices[0]?.message.content ?? "{}";
      const parsed = JSON.parse(raw.trim()) as {
        valor?: number | null;
        destinatario?: string | null;
        data?: string | null;
        metodo?: string | null;
      };

      if (parsed.valor != null) {
        ocr_amount_cents = Math.round(parsed.valor * 100);
      }

      // Build a human-readable verification note
      const parts: string[] = ["Comprovante verificado por OCR."];
      if (parsed.valor != null) {
        const expectedVal = existing.amount_cents != null ? existing.amount_cents / 100 : null;
        const match = expectedVal != null && Math.abs(parsed.valor - expectedVal) < 0.02;
        parts.push(`Valor: R$\u00A0${parsed.valor.toFixed(2)}${expectedVal != null ? (match ? " ✓" : ` (esperado R$\u00A0${expectedVal.toFixed(2)}) ⚠️`) : ""}.`);
      }
      if (parsed.destinatario) parts.push(`Para: ${parsed.destinatario}.`);
      if (parsed.data) parts.push(`Data: ${parsed.data.split("-").reverse().join("/")}.`);
      if (parsed.metodo) parts.push(`Método: ${parsed.metodo}.`);
      ocr_note = parts.join(" ");
    } catch (ocrErr) {
      req.log.warn({ ocrErr }, "OCR vision call failed, proceeding without verification");
      ocr_note = "Comprovante registrado. Verificação automática indisponível no momento.";
    }

    const [updated] = await db
      .update(paymentObligationsTable)
      .set({
        proof_url,
        status: "comprovante_received",
        paid_at: new Date(),
        // If OCR found an amount and the obligation has none, backfill it
        ...(ocr_amount_cents != null && existing.amount_cents == null
          ? { amount_cents: ocr_amount_cents }
          : {}),
      })
      .where(and(eq(paymentObligationsTable.id, id), eq(paymentObligationsTable.household_id, hid)))
      .returning();

    // Propagate status to the linked task so task-level views stay consistent
    await db
      .update(tasksTable)
      .set({
        payment_status: "comprovante_received",
        proof_attachment_url: proof_url,
      })
      .where(
        and(
          eq(tasksTable.household_id, hid),
          eq(tasksTable.payment_obligation_id, id),
        ),
      );

    return res.json({ obligation: updated, ocr_note });
  } catch (err) {
    req.log.error({ err }, "Failed to attach comprovante");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
