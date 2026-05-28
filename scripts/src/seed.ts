import { db } from "@workspace/db";
import {
  householdsTable,
  membersTable,
  contactsTable,
  inboxItemsTable,
  suggestedActionsTable,
  tasksTable,
  calendarEventsTable,
  rulesTable,
  patternObservationsTable,
  auditLogTable,
} from "@workspace/db";

async function seed() {
  console.log("Seeding Vesta database...");

  // Household
  const existingHousehold = await db.select().from(householdsTable).limit(1);
  if (existingHousehold.length > 0) {
    console.log("Data already seeded, skipping.");
    process.exit(0);
  }

  const [household] = await db.insert(householdsTable).values({
    name: "Casa dos Silva",
    location: "São Paulo, SP",
    plan: "premium",
    concierge_eligible: true,
  }).returning();

  console.log("Household created:", household.id);

  // Members
  const [mom] = await db.insert(membersTable).values([
    { household_id: household.id, name: "Ana Silva", role: "admin", phone: "+55 11 99999-0001" },
    { household_id: household.id, name: "Pedro Silva", role: "member", phone: "+55 11 99999-0002" },
    { household_id: household.id, name: "Avó Marcia", role: "restricted" },
  ]).returning();

  console.log("Members created");

  // Contacts
  await db.insert(contactsTable).values([
    { household_id: household.id, name: "Colégio São Luís", phone: "(11) 3456-7890", category: "escola", aliases: ["escola", "colégio"], notes: "Coordenadora: Dra. Fernanda" },
    { household_id: household.id, name: "Dra. Beatriz Alves", phone: "(11) 98765-4321", category: "saude", aliases: ["pediatra", "médica"], notes: "Pediatra - Unimed Paulista" },
    { household_id: household.id, name: "Maria (Diarista)", phone: "(11) 97654-3210", category: "diarista", aliases: ["Maria", "diarista"], notes: "Terças e sextas, das 8h às 17h" },
    { household_id: household.id, name: "Portaria - Edifício", phone: "(11) 3333-0000", category: "portaria", notes: "Plantão 24h" },
    { household_id: household.id, name: "Dr. Ricardo Nunes", phone: "(11) 3210-9876", category: "saude", aliases: ["dentista"], notes: "Odontopediatria - Shopping Faria Lima" },
    { household_id: household.id, name: "Academia Kids", phone: "(11) 2234-5678", category: "escola", aliases: ["natação", "academia"], notes: "Natação - quartas e sextas 16h" },
  ]);

  console.log("Contacts created");

  // Calendar events
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  await db.insert(calendarEventsTable).values([
    {
      household_id: household.id,
      title: "Natação — Guilherme",
      start_at: new Date(today.getTime() + 16 * 3600000),
      end_at: new Date(today.getTime() + 17 * 3600000),
      category: "escola",
      members: ["Guilherme"],
      source: "auto",
      sync_status: "synced",
    },
    {
      household_id: household.id,
      title: "Consulta Dra. Beatriz — Larissa",
      start_at: new Date(today.getTime() + 10 * 3600000),
      end_at: new Date(today.getTime() + 11 * 3600000),
      category: "saude",
      members: ["Larissa"],
      source: "auto",
      sync_status: "synced",
      notes: "Vacinação de rotina 4 anos",
    },
    {
      household_id: household.id,
      title: "Reunião de pais — Colégio São Luís",
      start_at: new Date(today.getTime() + 2 * 86400000 + 19 * 3600000),
      category: "escola",
      members: ["Ana", "Pedro"],
      source: "manual",
      sync_status: "local",
    },
    {
      household_id: household.id,
      title: "Festa aniversário — Sofia",
      start_at: new Date(today.getTime() + 3 * 86400000 + 15 * 3600000),
      end_at: new Date(today.getTime() + 3 * 86400000 + 19 * 3600000),
      category: "social",
      members: ["Guilherme"],
      source: "auto",
      sync_status: "synced",
      notes: "Casa da família Costa - Endereço: Rua das Flores, 123",
    },
    {
      household_id: household.id,
      title: "Faxina — Maria",
      start_at: new Date(today.getTime() + 86400000 + 8 * 3600000),
      end_at: new Date(today.getTime() + 86400000 + 17 * 3600000),
      category: "casa",
      source: "pattern",
      sync_status: "local",
    },
  ]);

  console.log("Calendar events created");

  // Inbox items
  const [inbox1] = await db.insert(inboxItemsTable).values({
    household_id: household.id,
    source: "whatsapp",
    raw_content: "Boa tarde, Ana! Aqui é a secretária do Colégio São Luís. Informamos que a reunião de pais será na próxima quinta-feira, dia 16, às 19h. Confirme sua presença.",
    sender_name: "Colégio São Luís",
    status: "ready_for_review",
  }).returning();

  const [inbox2] = await db.insert(inboxItemsTable).values({
    household_id: household.id,
    source: "whatsapp",
    raw_content: "Ana, a consulta da Larissa com a Dra. Beatriz está confirmada para amanhã às 10h. Lembre de trazer a carteirinha do plano e o cartão de vacinação.",
    sender_name: "Clínica Pediátrica Unimed",
    status: "approved",
  }).returning();

  const [inbox3] = await db.insert(inboxItemsTable).values({
    household_id: household.id,
    source: "whatsapp",
    raw_content: "Olá! Festa de aniversário da Sofia vai ser sábado, dia 17, das 15h às 19h. Endereço: Rua das Flores, 123. Por favor confirmem presença do Guilherme até sexta.",
    sender_name: "Família Costa",
    status: "ready_for_review",
  }).returning();

  const [inbox4] = await db.insert(inboxItemsTable).values({
    household_id: household.id,
    source: "whatsapp",
    raw_content: "Dona Ana, não vou conseguir ir na sexta-feira. Posso compensar na segunda?",
    sender_name: "Maria (Diarista)",
    status: "ready_for_review",
  }).returning();

  const [inbox5] = await db.insert(inboxItemsTable).values({
    household_id: household.id,
    source: "manual",
    raw_content: "Agendar revisão do ar condicionado antes do verão — técnico Marcos (11) 97777-1234",
    sender_name: "Nota manual",
    status: "received",
  }).returning();

  console.log("Inbox items created");

  // Suggested actions
  await db.insert(suggestedActionsTable).values([
    {
      inbox_item_id: inbox1.id,
      household_id: household.id,
      category: "escola",
      type: "event",
      title: "Reunião de pais — Colégio São Luís, quinta-feira 16/05 às 19h",
      datetime: new Date(today.getTime() + 2 * 86400000 + 19 * 3600000).toISOString(),
      suggested_owner: "Ana",
      approval_level: "one_tap",
      confidence: 0.91,
      status: "pending",
    },
    {
      inbox_item_id: inbox3.id,
      household_id: household.id,
      category: "social",
      type: "event",
      title: "Festa aniversário Sofia — confirmar presença do Guilherme",
      datetime: new Date(today.getTime() + 3 * 86400000 + 15 * 3600000).toISOString(),
      suggested_owner: "Pedro",
      approval_level: "one_tap",
      confidence: 0.88,
      status: "pending",
      cascade_check_needed: true,
    },
    {
      inbox_item_id: inbox4.id,
      household_id: household.id,
      category: "casa",
      type: "task",
      title: "Reagendar Maria — responder disponibilidade para segunda-feira",
      suggested_owner: "Ana",
      approval_level: "explicit",
      confidence: 0.72,
      status: "pending",
      notes: "Maria pediu para compensar a sexta na segunda",
      workflow_tags: ["diarista"],
    },
  ]);

  console.log("Suggested actions created");

  // Tasks
  await db.insert(tasksTable).values([
    {
      household_id: household.id,
      title: "Comprar papel sulfite A4 para escola",
      status: "pending",
      category: "escola",
      due_at: new Date(today.getTime() + 86400000),
      owner_id: mom.id,
    },
    {
      household_id: household.id,
      title: "Renovar matrícula academia de natação",
      status: "pending",
      category: "escola",
      due_at: new Date(today.getTime() + 5 * 86400000),
    },
    {
      household_id: household.id,
      title: "Pagar condomínio — vence dia 10",
      status: "pending",
      category: "casa",
      due_at: new Date(today.getTime() - 4 * 86400000),
      workflow_tags: ["payment_admin"],
    },
    {
      household_id: household.id,
      title: "Comprar presente aniversário Sofia",
      status: "pending",
      category: "social",
      due_at: new Date(today.getTime() + 2 * 86400000),
    },
    {
      household_id: household.id,
      title: "Agendar check-up odontológico Guilherme",
      status: "pending",
      category: "saude",
      due_at: new Date(today.getTime() + 7 * 86400000),
    },
    {
      household_id: household.id,
      title: "Atualizar lista de emergência escola",
      status: "done",
      category: "escola",
      completed_at: new Date(today.getTime() - 86400000),
    },
  ]);

  console.log("Tasks created");

  // Rules
  await db.insert(rulesTable).values([
    {
      household_id: household.id,
      name: "Agendamentos da escola",
      category: "escola",
      trigger_desc: "Mensagem do Colégio São Luís com data ou horário",
      action_desc: "Criar evento na agenda categoria Escola",
      approval_level: "one_tap",
      confidence: 0.92,
      active: true,
      origin: "system_template",
      times_triggered: 14,
      times_approved: 13,
      times_dismissed: 1,
    },
    {
      household_id: household.id,
      name: "Confirmação de consultas médicas",
      category: "saude",
      trigger_desc: "Mensagem de clínica ou consultório com data de consulta",
      action_desc: "Criar evento na agenda categoria Saúde + lembrete 2h antes",
      approval_level: "explicit",
      confidence: 0.87,
      active: true,
      origin: "system_template",
      times_triggered: 6,
      times_approved: 6,
      times_dismissed: 0,
    },
    {
      household_id: household.id,
      name: "Faxina da Maria — dias fixos",
      category: "casa",
      trigger_desc: "Terças e sextas-feiras — recorrente semanal",
      action_desc: "Bloquear agenda 8h–17h categoria Casa",
      approval_level: "soft",
      confidence: 0.96,
      active: true,
      origin: "pattern_suggested",
      times_triggered: 28,
      times_approved: 27,
      times_dismissed: 1,
    },
  ]);

  console.log("Rules created");

  // Patterns
  await db.insert(patternObservationsTable).values([
    {
      household_id: household.id,
      pattern_key: "escola_tarefa_dow1",
      type: "temporal",
      description: "recados da escola chegam toda segunda-feira de manhã",
      occurrences: 8,
      confidence: 0.85,
      status: "suggested",
      evidence: "8 mensagens do Colégio São Luís nas últimas 8 segundas-feiras entre 7h e 9h",
    },
    {
      household_id: household.id,
      pattern_key: "casa_task_dow5",
      type: "sender",
      description: "lista de compras semanal vem sempre da família às sextas",
      occurrences: 5,
      confidence: 0.72,
      status: "suggested",
      evidence: "Família Costa envia lista de compras todo domingo à noite",
    },
  ]);

  // Audit log
  await db.insert(auditLogTable).values([
    {
      household_id: household.id,
      action: "action_approved",
      actor: "Ana",
      action_type: "approved",
      category: "saude",
      description: "Aprovado: Consulta Dra. Beatriz — Larissa amanhã às 10h",
    },
    {
      household_id: household.id,
      action: "rule_triggered",
      actor: "system",
      action_type: "rule_triggered",
      category: "escola",
      description: "Regra aplicada: Agendamentos da escola → Natação adicionado à agenda",
    },
    {
      household_id: household.id,
      action: "task_completed",
      actor: "Ana",
      action_type: "task_completed",
      category: "escola",
      description: "Tarefa concluída: Atualizar lista de emergência escola",
    },
  ]);

  console.log("Audit log created");
  console.log("Seed complete!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
