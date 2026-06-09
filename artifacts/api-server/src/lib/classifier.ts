import { getLLMClient } from "@workspace/llm-client";
import { db } from "@workspace/db";
import {
  inboxItemsTable,
  suggestedActionsTable,
  contactsTable,
  actionCascadesTable,
  crecheWaitlistsTable,
  paymentObligationsTable,
  proactiveMessageQueueTable,
} from "@workspace/db";
import { eq, and, isNull, sql } from "drizzle-orm";
import { sendWhatsApp, resolveHouseholdAdminPhone } from "./whatsapp";
import { notifyCascadeDeepLink } from "../routes/cascades";

export type PaymentData = {
  amount_cents: number | null;
  recipient: string | null;
  due_date: string | null;
  payment_method: string | null;
};

export type CascadeIntent = {
  title: string;
  type: string;
  category: string;
  datetime: string | null;
  suggested_owner: string | null;
  approval_level: string;
  workflow_tags: string[];
  payment_data?: PaymentData | null;
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
  cascade_intents?: CascadeIntent[];
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
  // WF-24: backup care — must come before generic escola/diarista rules
  {
    patterns: [/creche\s*(fechou|fechada|vai fechar|não vai abrir|sem aula)|diarista\s*(cancelou|faltou|não vem|não vai vir)|filho\s*(doente|com febre|passando mal)|filha\s*(doente|com febre|passando mal)|criança\s*(doente|com febre)|emergência de cuidado/i],
    category: "logistica",
    type: "task",
    approval_level: "explicit",
    confidence: 0.87,
    workflow_tags: ["backup_care"],
  },
  // WF-23: school fees — must come before generic payment rule
  {
    patterns: [/mensalidade\s*(escola|creche|berçário|maternal)|boleto\s*(escola|creche)|taxa\s*(escolar|matrícula|de matrícula)|anuidade\s*(escola|colégio)|contribuição\s*(escola|colégio)/i],
    category: "escola",
    type: "payment",
    approval_level: "explicit",
    confidence: 0.88,
    workflow_tags: ["school_fee", "payment_admin"],
  },
  // WF-20: creche waitlist — must come before generic escola rule
  {
    patterns: [/lista\s*de\s*espera|fila\s*(da\s*creche|creche|de\s*creche)|vaga\s*(na\s*creche|em\s*creche|disponível\s*creche)|chamada\s*(da\s*creche|para\s*creche|de\s*vaga)|inscrição\s*(na\s*creche|creche)|berçário\s*(lista|vaga|fila|espera)/i],
    category: "escola",
    type: "task",
    approval_level: "one_tap",
    confidence: 0.88,
    workflow_tags: ["creche_waitlist"],
  },
  // WF-21: matrícula checklist — must come before generic escola rule
  {
    patterns: [/matr[ií]cula\s*(escolar|na\s*escola|na\s*creche|para\s*escola)?|lista\s*de\s*documentos?\s*(para\s*(escola|matr[ií]cula|creche))|documentação\s*(escolar|para\s*escola|matr[ií]cula|creche)/i],
    category: "escola",
    type: "task",
    approval_level: "explicit",
    confidence: 0.86,
    workflow_tags: ["matricula"],
  },
  {
    patterns: [/escola|colégio|creche|aula|reunião de pais|boletim|professor|coordenador|educação/i],
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
  "title": string,         // Título conciso da ação PRINCIPAL (máx 80 chars, em português)
  "category": string,      // Um de: escola | saude | casa | social | logistica | refeicoes | servicos | outros
  "type": string,          // Um de: event | task | reminder | fyi | payment
  "datetime": string|null, // Data/hora mencionada em texto simples (ex: "quinta-feira 19h", "dia 15/06"), ou null
  "suggested_owner": string|null, // Nome de pessoa mencionada para realizar a ação, ou null
  "approval_level": string, // Um de: soft | one_tap | explicit
  "confidence": number,    // 0.0 a 1.0
  "workflow_tags": string[], // Array de tags relevantes — ver lista abaixo
  "cascade_check_needed": boolean, // true se envolve pagamento, múltiplas pessoas ou evento recorrente
  "payment_data": {         // Preencher quando workflow_tags inclui "payment_admin" ou "school_fee", senão null
    "amount_cents": number|null,
    "recipient": string|null,
    "due_date": string|null,
    "payment_method": string|null
  } | null,
  "cascade_intents": [      // Array de intenções SEPARADAS quando a mensagem contém 2+ ações distintas
    {                        // Deixar VAZIO [] para mensagens de intenção única
      "title": string,
      "type": string,
      "category": string,
      "datetime": string|null,
      "suggested_owner": string|null,
      "approval_level": string,
      "workflow_tags": string[]
    }
  ]
}

Tags de workflow_tags disponíveis:
- "payment_admin"     — qualquer pagamento (R$, boleto, Pix, mensalidade, condomínio, aluguel)
- "school_fee"        — mensalidade escola/creche, taxa de matrícula, anuidade, boleto escolar
- "creche_waitlist"   — lista de espera de creche, fila de vaga, chamada de vaga, inscrição em berçário/creche
- "matricula"         — matrícula escolar/creche, lista de documentos para escola, documentação escolar
- "parent_group_triage" — mensagem de grupo de pais com múltiplos tópicos misturados (avisos FYI + itens de ação + itens a ignorar)
- "backup_care"       — creche/escola fechada inesperadamente, diarista cancelou, filho/filha doente, emergência de cuidado
- "diarista"          — diarista, faxina, limpeza doméstica
- "servicos"          — serviços de manutenção/reparo em casa

Regras especiais por workflow_tag:

WF-20 (creche_waitlist): Se detectar lista de espera de creche, vaga disponível ou chamada:
  - Adicionar "creche_waitlist" em workflow_tags
  - cascade_intents: []
  - approval_level: "one_tap"

WF-21 (matricula): Se detectar matrícula escolar ou lista de documentos:
  - Adicionar "matricula" em workflow_tags
  - cascade_intents: listar CADA documento como uma ação separada com type "task", approval_level "explicit"
  - Documentos típicos BR: certidão de nascimento, comprovante de endereço, cartão de vacinas, fotos 3x4, RG+CPF dos pais, declaração médica
  - Se houver taxa de matrícula, adicionar também "payment_admin" e preencher payment_data

WF-22 (parent_group_triage): Se detectar mensagem de grupo de pais com múltiplos assuntos misturados:
  - Separar em 3 buckets usando workflow_tags específicos:
    * Itens com ação obrigatória: workflow_tags ["parent_group_triage", "parent_group_triage_acao"], approval_level "explicit" ou "one_tap"
    * Avisos FYI (só para saber): workflow_tags ["parent_group_triage", "parent_group_triage_fyi"], approval_level "soft", type "fyi"
    * Itens irrelevantes/spam/ruído: workflow_tags ["parent_group_triage", "parent_group_triage_ignorar"], approval_level "soft", type "fyi"
  - Precisa de ≥2 cascade_intents

WF-23 (school_fee): Se detectar mensalidade escola/creche, boleto escolar ou taxa:
  - Adicionar "school_fee" E "payment_admin" em workflow_tags
  - Preencher payment_data com amount_cents, recipient, due_date, payment_method
  - approval_level: "explicit"

WF-24 (backup_care): Se detectar creche/escola fechada, diarista cancelou, filho/filha doente, emergência de cuidado:
  - Adicionar "backup_care" em workflow_tags de TODOS os cascade_intents
  - cascade_intents DEVE ter exatamente 5 itens nesta ordem:
    1. "Notificar escola/creche sobre ausência" (type "task", approval_level "one_tap")
    2. "Cancelar logística de busca" (type "task", approval_level "one_tap")
    3. "Acionar avó/cuidador backup" (type "task", approval_level "explicit")
    4. "Reagendar reuniões afetadas" (type "task", approval_level "one_tap")
    5. "Solicitar suporte Vesta" (type "fyi", approval_level "soft")

Regras para cascade_intents (geral):
- Preencher cascade_intents quando a mensagem dispara 2+ ações INDEPENDENTES (ou nas regras especiais acima)
- Para mensagens de intenção única SEM regras especiais, retornar cascade_intents: []
- Quando cascade_intents tem 2+ itens, o campo "title" no raiz descreve o gatilho geral

Regras gerais:
- approval_level "soft" = só aviso, não requer ação
- approval_level "one_tap" = confirmação rápida necessária
- approval_level "explicit" = revisão cuidadosa necessária (consulta médica, pagamento, serviço)
- Responda APENAS com o JSON, sem markdown, sem explicações.`;

async function classifyWithAI(text: string): Promise<ClassificationResult | null> {
  try {
    const raw = (await getLLMClient().chatCompletion(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: text.substring(0, 1500) },
      ],
      { maxTokens: 600 },
    )).trim();
    if (!raw) return null;

    // Strip markdown code fences if present
    const json = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    const parsed = JSON.parse(json) as Partial<ClassificationResult>;

    // Validate required fields
    if (!parsed.category || !parsed.type || !parsed.title) return null;

    const cascadeIntents = Array.isArray(parsed.cascade_intents)
      ? (parsed.cascade_intents as CascadeIntent[])
      : [];

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
      cascade_intents:      cascadeIntents,
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

  const labelSuffix = senderDisplayName ? ` — de ${senderDisplayName}` : "";

  // ── WF-21: matrícula → promote single-intent to document checklist cascade ─
  const wfTags = result.workflow_tags ?? [];
  if (wfTags.includes("matricula") && (result.cascade_intents ?? []).length === 0) {
    const baseIntents: CascadeIntent[] = [
      { title: "Reunir certidão de nascimento", type: "task", category: "escola", datetime: null, suggested_owner: null, approval_level: "explicit", workflow_tags: ["matricula"] },
      { title: "Providenciar comprovante de endereço (últimos 3 meses)", type: "task", category: "escola", datetime: result.datetime, suggested_owner: null, approval_level: "explicit", workflow_tags: ["matricula"] },
      { title: "Atualizar e copiar cartão de vacinas", type: "task", category: "escola", datetime: null, suggested_owner: null, approval_level: "explicit", workflow_tags: ["matricula"] },
      { title: "Tirar fotos 3×4 recentes", type: "task", category: "escola", datetime: null, suggested_owner: null, approval_level: "one_tap", workflow_tags: ["matricula"] },
      { title: "Copiar RG e CPF dos responsáveis", type: "task", category: "escola", datetime: null, suggested_owner: null, approval_level: "explicit", workflow_tags: ["matricula"] },
      { title: "Obter declaração médica", type: "task", category: "escola", datetime: null, suggested_owner: null, approval_level: "explicit", workflow_tags: ["matricula"] },
    ];
    if (result.payment_data?.amount_cents) {
      const feeLabel = `R$\u00A0${(result.payment_data.amount_cents / 100).toFixed(2).replace(".", ",")}`;
      baseIntents.push({
        title: `Pagar taxa de matrícula (${feeLabel})`,
        type: "payment",
        category: "escola",
        datetime: result.payment_data.due_date,
        suggested_owner: null,
        approval_level: "explicit",
        workflow_tags: ["matricula", "payment_admin"],
        payment_data: result.payment_data,
      });
    }
    result.cascade_intents = baseIntents;
    // Extract school/creche name for a descriptive cascade title
    const schoolMatch = item.raw_content.match(
      /(?:escola|colégio|creche|EMEI|EMEF|centro educacional)\s+(?:municipal\s+)?([A-Za-záéíóúâêîôûãõàèìòùçÁÉÍÓÚÂÊÎÔÛÃÕÀ\s]{2,30})/i,
    );
    const schoolName = schoolMatch?.[1]?.trim();
    const deadlinePart = result.datetime
      ? ` — prazo ${new Date(result.datetime).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`
      : "";
    if (schoolName) {
      result.title = `Matrícula — ${schoolName}${deadlinePart}`.substring(0, 120);
    } else if (!result.title.toLowerCase().includes("matrícula")) {
      result.title = `Matrícula — ${result.title}${deadlinePart}`.substring(0, 120);
    } else if (deadlinePart) {
      result.title = (result.title + deadlinePart).substring(0, 120);
    }
  }

  // ── WF-24: backup_care single-intent → promote to 5-item cascade ──────────
  if (wfTags.includes("backup_care") && (result.cascade_intents ?? []).length === 0) {
    result.cascade_intents = [
      { title: "Notificar escola/creche sobre ausência", type: "task", category: "escola", datetime: null, suggested_owner: null, approval_level: "one_tap", workflow_tags: ["backup_care"] },
      { title: "Cancelar logística de busca", type: "task", category: "logistica", datetime: null, suggested_owner: null, approval_level: "one_tap", workflow_tags: ["backup_care"] },
      { title: "Acionar avó/cuidador backup", type: "task", category: "logistica", datetime: null, suggested_owner: null, approval_level: "explicit", workflow_tags: ["backup_care"] },
      { title: "Reagendar reuniões afetadas", type: "task", category: "outros", datetime: null, suggested_owner: null, approval_level: "one_tap", workflow_tags: ["backup_care"] },
      { title: "Solicitar suporte Vesta", type: "fyi", category: "outros", datetime: null, suggested_owner: null, approval_level: "soft", workflow_tags: ["backup_care"] },
    ];
  }

  // ── Cascade path: ≥2 distinct intents from the same message ──────────────
  const intents = result.cascade_intents ?? [];
  if (intents.length >= 2) {
    const triggerDescription = result.title.substring(0, 120);

    // Determine cascade_type from the dominant workflow_tag across intents
    const allTags = intents.flatMap((i) => Array.isArray(i.workflow_tags) ? i.workflow_tags : []);
    const topLevelTags = Array.isArray(result.workflow_tags) ? result.workflow_tags : [];
    const combinedTags = [...topLevelTags, ...allTags];
    let cascade_type = "standard";
    if (combinedTags.includes("backup_care")) cascade_type = "backup_care";
    else if (combinedTags.includes("parent_group_triage")) cascade_type = "parent_group_triage";
    else if (combinedTags.includes("matricula")) cascade_type = "matricula";

    const [cascade] = await db
      .insert(actionCascadesTable)
      .values({
        household_id:        item.household_id,
        source_inbox_id:     inboxItemId,
        trigger_description: triggerDescription,
        cascade_type,
      })
      .returning();

    if (!cascade) throw new Error("Failed to create cascade");

    for (const intent of intents) {
      await db.insert(suggestedActionsTable).values({
        inbox_item_id:        inboxItemId,
        household_id:         item.household_id,
        cascade_id:           cascade.id,
        category:             intent.category ?? result.category,
        type:                 intent.type ?? "task",
        title:                (intent.title + labelSuffix).substring(0, 120),
        datetime:             intent.datetime ?? null,
        suggested_owner:      intent.suggested_owner ?? null,
        approval_level:       intent.approval_level ?? "one_tap",
        confidence:           result.confidence,
        status:               "pending",
        cascade_check_needed: true,
        workflow_tags:        Array.isArray(intent.workflow_tags) ? intent.workflow_tags : [],
        payment_data:         intent.payment_data ?? null,
      });
    }

    await db
      .update(inboxItemsTable)
      .set({ status: "ready_for_review" })
      .where(eq(inboxItemsTable.id, inboxItemId));

    // ── WF-22: parent_group_triage → auto-dismiss ignorar, auto-approve fyi ──
    if (cascade_type === "parent_group_triage") {
      await db
        .update(suggestedActionsTable)
        .set({ status: "dismissed" })
        .where(
          and(
            eq(suggestedActionsTable.cascade_id, cascade.id),
            eq(suggestedActionsTable.household_id, item.household_id),
            sql`${suggestedActionsTable.workflow_tags} @> ARRAY['parent_group_triage_ignorar']::text[]`,
          ),
        );
      await db
        .update(suggestedActionsTable)
        .set({ status: "approved" })
        .where(
          and(
            eq(suggestedActionsTable.cascade_id, cascade.id),
            eq(suggestedActionsTable.household_id, item.household_id),
            sql`${suggestedActionsTable.workflow_tags} @> ARRAY['parent_group_triage_fyi']::text[]`,
          ),
        );
    }

    // For ≥4 sub-items: send deep-link WA notification (in-app resolution required)
    if (intents.length >= 4) {
      try {
        await notifyCascadeDeepLink(item.household_id, triggerDescription, intents.length);
      } catch {
        // non-blocking
      }
    } else if (result.approval_level === "explicit") {
      const adminPhone = await resolveHouseholdAdminPhone(item.household_id);
      if (adminPhone) {
        const senderLabel = senderDisplayName ?? "alguém";
        void sendWhatsApp(
          adminPhone,
          `📬 ${intents.length} ações de *${senderLabel}* aguardam revisão no Vesta.`,
        );
      }
    }

    return;
  }

  // ── Single-intent path ────────────────────────────────────────────────────
  const actionTitle = (result.title + labelSuffix).substring(0, 120);

  // Check for an existing non-cascade action for this inbox item (re-classification)
  const [existing] = await db
    .select({ id: suggestedActionsTable.id })
    .from(suggestedActionsTable)
    .where(
      and(
        eq(suggestedActionsTable.inbox_item_id, inboxItemId),
        isNull(suggestedActionsTable.cascade_id),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(suggestedActionsTable)
      .set({
        category:             result.category,
        type:                 result.type,
        title:                actionTitle,
        datetime:             result.datetime,
        suggested_owner:      result.suggested_owner,
        approval_level:       result.approval_level,
        confidence:           result.confidence,
        cascade_check_needed: result.cascade_check_needed,
        workflow_tags:        result.workflow_tags,
        payment_data:         result.payment_data ?? null,
        updated_at:           new Date(),
      })
      .where(eq(suggestedActionsTable.id, existing.id));
  } else {
    await db.insert(suggestedActionsTable).values({
      inbox_item_id:        inboxItemId,
      household_id:         item.household_id,
      category:             result.category,
      type:                 result.type,
      title:                actionTitle,
      datetime:             result.datetime,
      suggested_owner:      result.suggested_owner,
      approval_level:       result.approval_level,
      confidence:           result.confidence,
      status:               "pending",
      cascade_check_needed: result.cascade_check_needed,
      workflow_tags:        result.workflow_tags,
      payment_data:         result.payment_data ?? null,
    });
  }

  await db
    .update(inboxItemsTable)
    .set({ status: "ready_for_review" })
    .where(eq(inboxItemsTable.id, inboxItemId));

  // ── WF-20: creche waitlist → auto-create waitlist tracking row ─────────────
  if (wfTags.includes("creche_waitlist")) {
    try {
      const rawName = item.raw_content.substring(0, 200);
      const nameMatch = rawName.match(/creche\s+([A-Za-záéíóúâêîôûãõàèìòùçÁÉÍÓÚÂÊÎÔÛÃÕÀ\s]{2,30})/i);
      const creche_name = (nameMatch?.[1]?.trim() ?? result.title.replace(/lista de espera|chamada|vaga|fila|creche/gi, "").trim()) || "Creche";
      await db.insert(crecheWaitlistsTable).values({
        household_id: item.household_id,
        creche_name: creche_name.substring(0, 100),
        source_inbox_id: inboxItemId,
        status: "waiting",
        document_checklist: [],
      });
    } catch {
      // non-blocking — best effort
    }
  }

  // ── WF-23: school fee → enrich payment_data with is_recurring + D-3 proactive ─
  // Payment obligation is intentionally NOT created here — it is created exactly
  // once in routes/actions.ts when the user approves the suggested action.
  // Creating it here would duplicate the obligation every time a message is classified.
  if (wfTags.includes("school_fee") && result.payment_data) {
    try {
      const rawLower = item.raw_content.toLowerCase();
      const isRecurring = /mensalidade|mensal|anuidade/.test(rawLower);
      // Persist is_recurring into the suggested action's payment_data JSONB so the
      // approval path in routes/actions.ts can use it without re-reading raw_content.
      await db.execute(sql`
        UPDATE suggested_actions
        SET payment_data = jsonb_set(
          COALESCE(payment_data, '{}'::jsonb),
          '{is_recurring}',
          ${isRecurring ? sql`'true'::jsonb` : sql`'false'::jsonb`}
        )
        WHERE inbox_item_id = ${inboxItemId}
          AND household_id  = ${item.household_id}
      `);
      // Enqueue proactive reminder 3 days before due date
      if (result.payment_data.due_date) {
        const dueDate = new Date(result.payment_data.due_date);
        if (!isNaN(dueDate.getTime())) {
          const d3Date = new Date(dueDate.getTime() - 3 * 24 * 60 * 60 * 1000);
          d3Date.setUTCHours(12, 0, 0, 0); // 12h UTC ≈ 09h BRT, before quiet hours start
          const dueDateStr = dueDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
          const feeLabel = result.payment_data.amount_cents
            ? ` (R$\u00A0${(result.payment_data.amount_cents / 100).toFixed(2).replace(".", ",")})`
            : "";
          const recipient = result.payment_data.recipient ? ` — ${result.payment_data.recipient}` : "";
          await db.insert(proactiveMessageQueueTable).values({
            household_id:  item.household_id,
            trigger_type:  "payment_due",
            template_name: `school_fee_d3_inbox_${inboxItemId}`,
            payload: {
              message:
                `💰 *Lembrete de pagamento:*\n\n` +
                `*${result.title.substring(0, 80)}${recipient}${feeLabel}* vence em ${dueDateStr}.\n\n` +
                `_Abra o Vesta para confirmar o pagamento._`,
            },
            scheduled_at: d3Date,
            status:        "queued",
          });
        }
      }
    } catch {
      // non-blocking — best effort
    }
  }

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
