import { openai } from "@workspace/integrations-openai-ai-server";
import { db } from "@workspace/db";
import { inboxItemsTable, suggestedActionsTable, contactsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { sendWhatsApp, resolveHouseholdAdminPhone } from "./whatsapp";

export type PaymentData = {
  amount_cents: number | null;
  recipient: string | null;
  due_date: string | null;
  payment_method: string | null;
};

export type ClassificationResult = {
  category: string;
  type: string;
  approval_level: string;
  confidence: number;
  title: string;
  datetime: string | null;
  suggested_owner: string | null;
  workflow_tags: string[];
  cascade_check_needed: boolean;
  payment_data?: PaymentData | null;
};

function extractAmountCents(text: string): number | null {
  const match = text.match(/R\$\s*([\d.,]+)/i);
  if (!match) return null;
  const raw = match[1].replace(/\./g, "").replace(",", ".");
  const value = parseFloat(raw);
  if (isNaN(value)) return null;
  return Math.round(value * 100);
}

function extractPaymentMethod(text: string): string | null {
  if (/\bpix\b/i.test(text)) return "pix";
  if (/boleto/i.test(text)) return "boleto";
  if (/\bted\b|\bdoc\b/i.test(text)) return "ted";
  if (/cart[ãa]o/i.test(text)) return "cartao";
  if (/dinheiro/i.test(text)) return "dinheiro";
  return null;
}

function extractPaymentData(text: string): PaymentData {
  return {
    amount_cents:   extractAmountCents(text),
    recipient:      null,
    due_date:       null,
    payment_method: extractPaymentMethod(text),
  };
}

/* ──────────────────────────────────────────────
   Keyword-based fallback classifier
   (used when OpenAI is unavailable or fails)
────────────────────────────────────────────── */
const KEYWORD_RULES: Array<{
  patterns: RegExp[];
  category: string;
  type?: string;
  approval_level: string;
  confidence: number;
  workflow_tags?: string[];
}> = [
  {
    patterns: [/escola|colégio|creche|aula|reunião de pais|matrícula|boletim|professor|coordenador|educação/i],
    category: "escola",
    approval_level: "one_tap",
    confidence: 0.78,
  },
  {
    patterns: [/consulta|médico|médica|pediatr|dentista|vacina|saúde|exame|receita|clínica|hospital|unimed|plano de saúde/i],
    category: "saude",
    type: "event",
    approval_level: "explicit",
    confidence: 0.80,
  },
  {
    patterns: [/diarista|faxina|limpeza|maria|empregada|doméstica/i],
    category: "casa",
    approval_level: "one_tap",
    confidence: 0.85,
    workflow_tags: ["diarista"],
  },
  {
    patterns: [/festa|aniversário|churrasco|churras|comemoração|celebração|convite/i],
    category: "social",
    approval_level: "one_tap",
    confidence: 0.78,
  },
  {
    patterns: [/buscar|busca|levar|pegar|pickup|transporte|carona|conduzir/i],
    category: "logistica",
    approval_level: "one_tap",
    confidence: 0.72,
  },
  {
    patterns: [/compra|feira|mercado|supermercado|lista de compras|mantimento/i],
    category: "refeicoes",
    approval_level: "one_tap",
    confidence: 0.75,
  },
  {
    patterns: [/encanador|eletricista|técnico|conserto|manutenção|reparo|obra|instalação/i],
    category: "servicos",
    approval_level: "explicit",
    confidence: 0.73,
    workflow_tags: ["servicos"],
  },
  {
    patterns: [/condomínio|boleto|aluguel|conta|pagamento|pix|transferência|cobrar/i],
    category: "casa",
    approval_level: "explicit",
    confidence: 0.72,
    workflow_tags: ["payment_admin"],
  },
];

const TYPE_RULES: Array<{ patterns: RegExp[]; type: string; approval_level?: string; confidence_boost?: number }> = [
  { patterns: [/confirmad|confirmado|agendad|agendado|marcad/i], type: "event", confidence_boost: 0.05 },
  { patterns: [/lembr|não esquecer|não esquece/i], type: "reminder" },
  { patterns: [/informando|comunicamos|aviso|circular|nota de/i], type: "fyi", approval_level: "soft", confidence_boost: 0.08 },
  { patterns: [/preciso|precisa|precisamos|por favor|poderia|consegue/i], type: "task" },
];

export function classifyText(text: string): ClassificationResult {
  const lowerText = text.toLowerCase();

  let category = "outros";
  let approval_level = "one_tap";
  let confidence = 0.55;
  let workflow_tags: string[] = [];
  let cascade_check_needed = false;

  for (const rule of KEYWORD_RULES) {
    if (rule.patterns.some((p) => p.test(lowerText))) {
      category = rule.category;
      approval_level = rule.approval_level;
      confidence = rule.confidence;
      workflow_tags = rule.workflow_tags ?? [];
      break;
    }
  }

  let type = "task";
  for (const rule of TYPE_RULES) {
    if (rule.patterns.some((p) => p.test(lowerText))) {
      type = rule.type;
      if (rule.approval_level) approval_level = rule.approval_level;
      if (rule.confidence_boost) confidence = Math.min(0.98, confidence + rule.confidence_boost);
      break;
    }
  }

  // Datetime detection → upgrade to event
  const dateMatch = lowerText.match(/\d{1,2}h|\d{1,2}:\d{2}|amanhã|segunda|terça|quarta|quinta|sexta|sábado|domingo|\d{1,2}\/\d{1,2}/);
  if (dateMatch) {
    type = "event";
    confidence = Math.min(0.98, confidence + 0.04);
  }

  let payment_data: PaymentData | null = null;
  if (/r\$|reais|pagament|pix|boleto|transferência|mensalidade|comprovante|condomínio|aluguel/.test(lowerText)) {
    workflow_tags = [...new Set([...workflow_tags, "payment_admin"])];
    cascade_check_needed = true;
    approval_level = "explicit";
    payment_data = extractPaymentData(text);
  }

  const title = text.split(/\n/)[0]?.substring(0, 80) ?? text.substring(0, 80);
  const datetime = dateMatch ? dateMatch[0] : null;

  return {
    category, type, approval_level, confidence,
    title, datetime, suggested_owner: null,
    workflow_tags, cascade_check_needed, payment_data,
  };
}

/* ──────────────────────────────────────────────
   LLM-based classifier (GPT-5-mini)
   Returns null on any failure → caller falls back to keywords
────────────────────────────────────────────── */
const SYSTEM_PROMPT = `Você é um assistente que extrai informações de mensagens domésticas brasileiras recebidas via WhatsApp.

Dado o texto de uma mensagem, retorne um JSON com exatamente estes campos:
{
  "title": string,         // Título conciso da ação (máx 80 chars, em português)
  "category": string,      // Um de: escola | saude | casa | social | logistica | refeicoes | servicos | outros
  "type": string,          // Um de: event | task | reminder | fyi | payment
  "datetime": string|null, // Data/hora mencionada em texto simples (ex: "quinta-feira 19h", "dia 15/06"), ou null
  "suggested_owner": string|null, // Nome de pessoa mencionada para realizar a ação, ou null
  "approval_level": string, // Um de: soft | one_tap | explicit
  "confidence": number,    // 0.0 a 1.0
  "workflow_tags": string[], // Array de tags relevantes. Inclua "payment_admin" se houver pagamento (R$, boleto, Pix, mensalidade, etc.)
  "cascade_check_needed": boolean, // true se envolve pagamento, múltiplas pessoas ou evento recorrente
  "payment_data": {         // Preencher quando workflow_tags inclui "payment_admin", senão null
    "amount_cents": number|null, // Valor em centavos (ex: R$150,00 = 15000), ou null
    "recipient": string|null,    // Nome de quem deve receber o pagamento, ou null
    "due_date": string|null,     // Data de vencimento em formato YYYY-MM-DD, ou null
    "payment_method": string|null // Um de: pix | boleto | cartao | dinheiro | ted, ou null
  } | null
}

Regras:
- approval_level "soft" = só aviso, não requer ação
- approval_level "one_tap" = confirmação rápida necessária
- approval_level "explicit" = revisão cuidadosa necessária (consulta médica, pagamento, serviço)
- cascade_check_needed = true para pagamentos, múltiplas crianças/pessoas, ou eventos com custo
- Para mensagens com R$, boleto, Pix, mensalidade, condomínio: sempre incluir "payment_admin" em workflow_tags
- Responda APENAS com o JSON, sem markdown, sem explicações.`;

async function classifyWithAI(text: string): Promise<ClassificationResult | null> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 400,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: text.substring(0, 1500) },
      ],
    });

    const raw = response.choices[0]?.message?.content?.trim();
    if (!raw) return null;

    // Strip markdown code fences if present
    const json = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    const parsed = JSON.parse(json) as Partial<ClassificationResult>;

    // Validate required fields
    if (!parsed.category || !parsed.type || !parsed.title) return null;

    return {
      title:                (parsed.title ?? text.substring(0, 80)).substring(0, 80),
      category:             parsed.category ?? "outros",
      type:                 parsed.type ?? "task",
      datetime:             parsed.datetime ?? null,
      suggested_owner:      parsed.suggested_owner ?? null,
      approval_level:       parsed.approval_level ?? "one_tap",
      confidence:           typeof parsed.confidence === "number" ? Math.min(1, Math.max(0, parsed.confidence)) : 0.85,
      workflow_tags:        Array.isArray(parsed.workflow_tags) ? parsed.workflow_tags : [],
      cascade_check_needed: parsed.cascade_check_needed ?? false,
      payment_data:         (parsed as { payment_data?: PaymentData | null }).payment_data ?? null,
    };
  } catch {
    return null;
  }
}

/* ──────────────────────────────────────────────
   Main pipeline: AI → keyword fallback → DB save
────────────────────────────────────────────── */
export async function classifyAndSaveAction(inboxItemId: number): Promise<void> {
  const [item] = await db
    .select()
    .from(inboxItemsTable)
    .where(eq(inboxItemsTable.id, inboxItemId));

  if (!item) throw new Error(`Inbox item ${inboxItemId} not found`);

  // Try AI first, fall back to keywords on failure
  const result = (await classifyWithAI(item.raw_content)) ?? classifyText(item.raw_content);

  // Look up contact for better display name — scoped to the inbox item's household
  let senderDisplayName = item.sender_name;
  if (item.sender_name) {
    const contacts = await db
      .select()
      .from(contactsTable)
      .where(
        and(
          eq(contactsTable.household_id, item.household_id),
          eq(contactsTable.name, item.sender_name),
        ),
      );
    if (contacts.length > 0) senderDisplayName = contacts[0].name;
  }

  const actionTitle = senderDisplayName
    ? `${result.title} — de ${senderDisplayName}`
    : result.title;

  await db.insert(suggestedActionsTable).values({
    inbox_item_id:        inboxItemId,
    household_id:         item.household_id,
    category:             result.category,
    type:                 result.type,
    title:                actionTitle.substring(0, 120),
    datetime:             result.datetime,
    suggested_owner:      result.suggested_owner,
    approval_level:       result.approval_level,
    confidence:           result.confidence,
    status:               "pending",
    cascade_check_needed: result.cascade_check_needed,
    workflow_tags:        result.workflow_tags,
    payment_data:         result.payment_data ?? null,
  }).onConflictDoUpdate({
    target: suggestedActionsTable.inbox_item_id,
    set: {
      category:             result.category,
      type:                 result.type,
      title:                actionTitle.substring(0, 120),
      datetime:             result.datetime,
      suggested_owner:      result.suggested_owner,
      approval_level:       result.approval_level,
      confidence:           result.confidence,
      cascade_check_needed: result.cascade_check_needed,
      workflow_tags:        result.workflow_tags,
      payment_data:         result.payment_data ?? null,
      updated_at:           new Date(),
    },
  });

  await db
    .update(inboxItemsTable)
    .set({ status: "ready_for_review" })
    .where(eq(inboxItemsTable.id, inboxItemId));

  // Notify household admin for explicit-approval items
  if (result.approval_level === "explicit") {
    const adminPhone = await resolveHouseholdAdminPhone(item.household_id);
    if (adminPhone) {
      const senderLabel = senderDisplayName ?? "alguém";
      void sendWhatsApp(
        adminPhone,
        `📬 Nova mensagem de *${senderLabel}* para revisar no Vesta.`,
      );
    }
  }
}
