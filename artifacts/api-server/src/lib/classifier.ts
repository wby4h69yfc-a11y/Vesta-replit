import { db } from "@workspace/db";
import { inboxItemsTable, suggestedActionsTable, contactsTable, membersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { sendWhatsApp } from "./whatsapp";

export type ClassificationResult = {
  category: string;
  type: string;
  approval_level: string;
  confidence: number;
  title: string;
  workflow_tags: string[];
  cascade_check_needed: boolean;
};

const KEYWORD_RULES: Array<{
  patterns: RegExp[];
  category: string;
  type?: string;
  approval_level: string;
  confidence: number;
  workflow_tags?: string[];
}> = [
  {
    patterns: [/escola|colégio|creche|aula|reunião de pais|matrícula|boletim|professor|coordenadot|educação/i],
    category: "escola",
    approval_level: "one_tap",
    confidence: 0.88,
  },
  {
    patterns: [/consulta|médico|médica|pediatr|dentista|vacina|saúde|exame|receita|clínica|hospital|unimed|plano de saúde/i],
    category: "saude",
    type: "event",
    approval_level: "explicit",
    confidence: 0.85,
  },
  {
    patterns: [/diarista|faxina|limpeza|maria|empregada|doméstica/i],
    category: "casa",
    approval_level: "one_tap",
    confidence: 0.90,
    workflow_tags: ["diarista"],
  },
  {
    patterns: [/festa|aniversário|churrasco|churras|comemoração|celebração|convite/i],
    category: "social",
    approval_level: "one_tap",
    confidence: 0.82,
  },
  {
    patterns: [/buscar|busca|levar|pegar|pickup|transporte|carona|conduzir/i],
    category: "logistica",
    approval_level: "one_tap",
    confidence: 0.77,
  },
  {
    patterns: [/compra|feira|mercado|supermercado|lista de compras|mantimento/i],
    category: "refeicoes",
    approval_level: "one_tap",
    confidence: 0.80,
  },
  {
    patterns: [/encanador|eletricista|técnico|conserto|manutenção|reparo|obra|instalação/i],
    category: "servicos",
    approval_level: "explicit",
    confidence: 0.78,
    workflow_tags: ["servicos"],
  },
  {
    patterns: [/condomínio|boleto|aluguel|conta|pagamento|pix|transferência|cobrar/i],
    category: "casa",
    approval_level: "explicit",
    confidence: 0.76,
    workflow_tags: ["payment_admin"],
  },
];

const TYPE_RULES: Array<{ patterns: RegExp[]; type: string; approval_level?: string; confidence_boost?: number }> = [
  { patterns: [/confirmad|confirmado|agendad|agendado|marcad/i], type: "event", confidence_boost: 0.05 },
  { patterns: [/lembr|não esquecer|não esquece/i], type: "reminder" },
  { patterns: [/informando|comunicamos|aviso|circular|nota de/i], type: "fyi", approval_level: "soft", confidence_boost: 0.08 },
  { patterns: [/preciso|precisa|precisamos|por favor|poderia|consegue|consegui/i], type: "task" },
];

export function classifyText(text: string, senderName?: string | null): ClassificationResult {
  const lowerText = text.toLowerCase();

  // Match category
  let category = "outros";
  let approval_level = "one_tap";
  let confidence = 0.60;
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

  // Match type
  let type = "task";
  for (const rule of TYPE_RULES) {
    if (rule.patterns.some((p) => p.test(lowerText))) {
      type = rule.type;
      if (rule.approval_level) approval_level = rule.approval_level;
      if (rule.confidence_boost) confidence = Math.min(0.98, confidence + rule.confidence_boost);
      break;
    }
  }

  // Boost confidence for explicit event words
  if (/\d{1,2}h|\d{1,2}:\d{2}|amanhã|segunda|terça|quarta|quinta|sexta|sábado|domingo|\d{1,2}\/\d{1,2}/.test(lowerText)) {
    type = "event";
    confidence = Math.min(0.98, confidence + 0.04);
  }

  // Payment detection
  if (/r\$|reais|pagament|pix|boleto|transferência/.test(lowerText)) {
    workflow_tags = [...new Set([...workflow_tags, "payment_admin"])];
    cascade_check_needed = true;
    approval_level = "explicit";
  }

  // Cascade: multiple people or things mentioned
  if (/guilherme|larissa|pedro|ana|criança|filho|filha/.test(lowerText) && type === "event") {
    cascade_check_needed = true;
  }

  // Title: first line, trimmed to 80 chars
  const title = text.split(/\n/)[0]?.substring(0, 80) ?? text.substring(0, 80);

  return {
    category,
    type,
    approval_level,
    confidence,
    title,
    workflow_tags,
    cascade_check_needed,
  };
}

export async function classifyAndSaveAction(inboxItemId: number): Promise<void> {
  const [item] = await db
    .select()
    .from(inboxItemsTable)
    .where(eq(inboxItemsTable.id, inboxItemId));

  if (!item) throw new Error(`Inbox item ${inboxItemId} not found`);

  const result = classifyText(item.raw_content, item.sender_name);

  // Look up contact for better title
  let senderDisplayName = item.sender_name;
  if (item.sender_name) {
    const contacts = await db
      .select()
      .from(contactsTable)
      .where(eq(contactsTable.name, item.sender_name));
    if (contacts.length > 0) {
      senderDisplayName = contacts[0].name;
    }
  }

  const actionTitle = senderDisplayName
    ? `${result.title} — de ${senderDisplayName}`
    : result.title;

  await db.insert(suggestedActionsTable).values({
    inbox_item_id: inboxItemId,
    household_id: item.household_id,
    category: result.category,
    type: result.type,
    title: actionTitle.substring(0, 120),
    approval_level: result.approval_level,
    confidence: result.confidence,
    status: "pending",
    cascade_check_needed: result.cascade_check_needed,
    workflow_tags: result.workflow_tags,
  });

  await db
    .update(inboxItemsTable)
    .set({ status: "ready_for_review" })
    .where(eq(inboxItemsTable.id, inboxItemId));

  // Notify household admin when the action requires explicit approval
  if (result.approval_level === "explicit") {
    // Find admin member phone scoped to this household
    const adminMembers = await db
      .select()
      .from(membersTable)
      .where(
        and(
          eq(membersTable.household_id, item.household_id),
          eq(membersTable.role, "admin"),
        ),
      )
      .limit(5);

    // Fall back to any member with a phone in this household
    let adminPhone: string | null = adminMembers.find((m) => m.phone)?.phone ?? null;
    if (!adminPhone) {
      const anyMember = await db
        .select()
        .from(membersTable)
        .where(eq(membersTable.household_id, item.household_id))
        .limit(10);
      adminPhone = anyMember.find((m) => m.phone)?.phone ?? null;
    }

    if (adminPhone) {
      const senderLabel = senderDisplayName ?? "alguém";
      void sendWhatsApp(
        adminPhone,
        `📬 Nova mensagem de *${senderLabel}* para revisar no Vesta.`,
      );
    }
  }
}
