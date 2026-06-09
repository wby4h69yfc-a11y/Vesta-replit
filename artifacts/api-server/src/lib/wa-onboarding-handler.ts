/**
 * WhatsApp-native onboarding handler
 *
 * State machine: WELCOME → NAME_CITY → HOUSEHOLD_COMPOSITION → RULE_TEMPLATES → COMPLETE
 *
 * Flow triggered when an inbound WA message arrives from a phone number
 * that is not yet linked to any household.
 *
 * LGPD gate: no personal data is persisted until the user replies ACEITO
 * in the WELCOME step.
 *
 * On COMPLETE:
 *   - A user + household + admin member record are created.
 *   - whatsapp_verified is set to true in onboarding_state.
 *   - A one-time magic token is written so the user can claim a web session.
 *   - All selected rule templates are activated.
 */

import crypto from "crypto";
import type { Logger } from "pino";
import { db } from "@workspace/db";
import {
  waOnboardingSessionsTable,
  usersTable,
  householdsTable,
  membersTable,
  onboardingStateTable,
  ruleTemplatesTable,
  rulesTable,
} from "@workspace/db";
import type { WaOnboardingStep, WaOnboardingData } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { isOnboardingRestartGreeting, replyWarmRestart } from "./wa-onboarding-recovery";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAGIC_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

/** Normalise a raw phone string to digits only. */
function normalisePhone(p: string): string {
  return p.replace(/\D/g, "");
}

/** Generate a cryptographically random magic token. */
function generateMagicToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

/**
 * Result returned to the webhook — always contains the reply to send back.
 */
export interface WaOnboardingOutcome {
  kind: "wa_onboarding";
  phone: string;
  reply: string;
}

// ── Reply builders ────────────────────────────────────────────────────────────

function replyWelcome(): string {
  return (
    "👋 Olá! Eu sou a *Vesta*, assistente de logística familiar.\n\n" +
    "Posso organizar mensagens da escola, consultas, boletos e muito mais — " +
    "tudo pelo WhatsApp.\n\n" +
    "📋 *Aviso de privacidade (LGPD):*\n" +
    "Para configurar sua conta coletarei seu nome, cidade e composição familiar. " +
    "Seus dados são usados exclusivamente para personalizar o Vesta e não são " +
    "compartilhados com terceiros.\n\n" +
    "Para continuar, responda *ACEITO*.\n" +
    "Para saber mais sobre privacidade, acesse: https://vesta.app/privacidade"
  );
}

function replyAskNameCity(): string {
  return (
    "✨ Ótimo! Vamos começar.\n\n" +
    "Como você quer ser chamado(a) e de qual cidade?\n\n" +
    "_Ex: Maria, São Paulo_"
  );
}

function replyAskComposition(): string {
  return (
    "🏠 Quantos adultos e crianças moram na sua casa?\n\n" +
    "_Ex: 2 adultos, 1 criança_\n" +
    "_(ou apenas: 2 adultos)_"
  );
}

function replyAskTemplates(): string {
  return (
    "⚡ Quase lá! Ative as categorias que fazem sentido para você:\n\n" +
    "1️⃣ *Escola* — avisos, boletos e reuniões escolares\n" +
    "2️⃣ *Saúde* — consultas e receitas médicas\n" +
    "3️⃣ *Finanças* — boletos e lembretes de pagamento\n\n" +
    "Responda com os números separados por vírgula.\n" +
    "_Ex: 1, 2_  ou  _Todos_  ou  _Nenhum_"
  );
}

function replyComplete(name: string, magicToken: string, domain: string | null): string {
  const appUrl = domain
    ? `https://${domain}/app?magic=${magicToken}`
    : null;
  const linkLine = appUrl
    ? `\n\n🔗 Acesse o Vesta no navegador (válido por 30 min):\n${appUrl}`
    : "";
  return (
    `✅ Tudo pronto, *${name}*! Sua casa foi criada.\n\n` +
    `Agora você pode me encaminhar mensagens — escola, consulta, boleto, diarista. ` +
    `Vou organizar tudo e te avisar quando precisar aprovar algo.${linkLine}\n\n` +
    `_Dica: responda com PAUSAR para silenciar por 24h, PARAR para desativar._`
  );
}

function replyLgpdRequired(): string {
  return (
    "Para usar o Vesta você precisa aceitar o aviso de privacidade.\n\n" +
    "Responda *ACEITO* para continuar."
  );
}

function replyUnknownInput(step: WaOnboardingStep): string {
  switch (step) {
    case "WELCOME":
      return "Responda *ACEITO* para aceitar o aviso de privacidade e continuar.";
    case "NAME_CITY":
      return "Por favor, informe seu nome (e cidade, se quiser).\n_Ex: Maria, São Paulo_";
    case "HOUSEHOLD_COMPOSITION":
      return "Por favor, informe quantos adultos e crianças moram na sua casa.\n_Ex: 2 adultos, 1 criança_";
    case "RULE_TEMPLATES":
      return (
        "Responda com os números das categorias que quer ativar (1, 2 e/ou 3), " +
        "*Todos* ou *Nenhum*."
      );
    default:
      return "Não entendi. Tente novamente ou acesse o app para continuar.";
  }
}

// ── Input parsers ─────────────────────────────────────────────────────────────

/** Parse "Maria, São Paulo" → { name: "Maria", city: "São Paulo" } */
function parseNameCity(text: string): { name: string; city?: string } | null {
  const cleaned = text.trim();
  if (!cleaned) return null;
  const parts = cleaned.split(/[,，]/);
  const name = parts[0]?.trim();
  if (!name) return null;
  const city = parts[1]?.trim() || undefined;
  return { name, city };
}

/** Parse "2 adultos, 1 criança" → { adults: 2, children: 1 } */
function parseComposition(text: string): { adults: number; children: number } {
  const cleaned = text.toLowerCase();
  const adultMatch = cleaned.match(/(\d+)\s*adulto/);
  const childMatch = cleaned.match(/(\d+)\s*crian/);
  // Fallback: if just a number with no keyword, treat as adults
  const bareNumber = !adultMatch && !childMatch ? cleaned.match(/^(\d+)$/) : null;
  const adults = adultMatch ? parseInt(adultMatch[1], 10) : bareNumber ? parseInt(bareNumber[1], 10) : 1;
  const children = childMatch ? parseInt(childMatch[1], 10) : 0;
  return { adults: Math.max(1, Math.min(adults, 10)), children: Math.max(0, Math.min(children, 10)) };
}

const TEMPLATE_MAP: Record<string, string[]> = {
  "1": ["escola"],
  "2": ["saude"],
  "3": ["financeiro", "financas", "finanças"],
};

/** Parse "1, 2" or "todos" or "nenhum" → list of category slugs */
function parseTemplateSelection(text: string): string[] {
  const cleaned = text.trim().toLowerCase();
  if (cleaned === "todos" || cleaned === "tudo") return ["escola", "saude", "financeiro"];
  if (cleaned === "nenhum" || cleaned === "não" || cleaned === "nao") return [];
  const selected: string[] = [];
  const nums = cleaned.match(/\d/g) ?? [];
  for (const n of nums) {
    const cats = TEMPLATE_MAP[n];
    if (cats) selected.push(...cats);
  }
  return [...new Set(selected)];
}

// ── Account creation ──────────────────────────────────────────────────────────

/**
 * Creates user + household + member + onboarding_state records from the
 * collected session data. Activates selected rule templates.
 * Returns the created user id and magic token.
 */
async function createAccountFromSession(
  session: { phone: string; data: WaOnboardingData },
  log: Logger,
): Promise<{ userId: string; magicToken: string }> {
  const { phone, data } = session;
  const name = data.name ?? "Usuário";
  const city = data.city ?? null;
  const adults = data.adults ?? 1;
  const children = data.children ?? 0;

  // 1. Create user record (phone-only, no OIDC link yet)
  const [user] = await db
    .insert(usersTable)
    .values({
      phone,
      firstName: name,
    })
    .onConflictDoUpdate({
      target: usersTable.phone,
      set: { firstName: name },
    })
    .returning({ id: usersTable.id });

  if (!user) throw new Error("Failed to create user");
  const userId = user.id;

  // 2. Create household
  const householdName = `Casa de ${name}`;
  const [household] = await db
    .insert(householdsTable)
    .values({
      name: householdName,
      location: city ?? undefined,
    })
    .returning({ id: householdsTable.id });

  if (!household) throw new Error("Failed to create household");
  const householdId = household.id;

  // 3. Link user to household
  await db
    .update(usersTable)
    .set({ household_id: householdId })
    .where(eq(usersTable.id, userId));

  // 4. Create admin member record with verified phone
  await db.insert(membersTable).values({
    household_id: householdId,
    user_id: userId,
    name,
    display_name: name,
    role: "admin",
    relationship_type: "adult",
    phone,
  });

  // 5. Create composition members (children)
  for (let i = 0; i < Math.max(0, adults - 1); i++) {
    await db.insert(membersTable).values({
      household_id: householdId,
      name: `Adulto ${i + 2}`,
      display_name: `Adulto ${i + 2}`,
      role: "member",
      relationship_type: "adult",
    });
  }
  for (let i = 0; i < children; i++) {
    await db.insert(membersTable).values({
      household_id: householdId,
      name: `Criança ${i + 1}`,
      display_name: `Criança ${i + 1}`,
      role: "member",
      relationship_type: "child",
    });
  }

  // 6. Create onboarding_state (WhatsApp verified)
  await db.insert(onboardingStateTable).values({
    user_id: userId,
    household_id: householdId,
    current_step: 7,
    completed: true,
    composition: { adults, children, others: 0 },
    whatsapp_verified: true,
    whatsapp_verified_phone: phone,
  });

  // 7. Activate selected rule templates (up to 3 — free plan limit)
  const selectedCategories = data.selectedTemplates ?? [];
  if (selectedCategories.length > 0) {
    try {
      const templates = await db
        .select()
        .from(ruleTemplatesTable)
        .where(and(
          sql`${ruleTemplatesTable.category} = ANY(${selectedCategories})`,
          eq(ruleTemplatesTable.is_active, true),
        ));

      for (const tpl of templates.slice(0, 3)) {
        const existing = await db
          .select({ id: rulesTable.id })
          .from(rulesTable)
          .where(and(
            eq(rulesTable.household_id, householdId),
            eq(rulesTable.source_template_id, tpl.id),
          ))
          .limit(1);
        if (existing.length > 0) continue;
        await db.insert(rulesTable).values({
          household_id: householdId,
          name: tpl.name,
          category: tpl.category,
          trigger_desc: tpl.trigger_config.trigger_desc,
          action_desc: tpl.action_config.action_desc,
          approval_level: tpl.action_config.approval_level,
          confidence: 0.9,
          active: true,
          origin: "system_template",
          source_template_id: tpl.id,
        });
      }
    } catch (err) {
      log.warn({ err }, "wa-onboarding: failed to activate templates (non-fatal)");
    }
  }

  // 8. Generate magic token
  const magicToken = generateMagicToken();

  log.info({ userId, householdId, phone }, "wa-onboarding: account created");

  return { userId, magicToken };
}

// ── Main handler ──────────────────────────────────────────────────────────────

/**
 * Processes one message from an unknown sender through the onboarding
 * state machine. Creates or updates the session row. On COMPLETE, creates
 * the full account structure.
 *
 * Returns null if the phone already has a household (should not be called
 * in that case, but defensive).
 */
export async function handleWaOnboarding(
  phoneRaw: string,
  bodyText: string,
  log: Logger,
): Promise<WaOnboardingOutcome> {
  const phoneNorm = normalisePhone(phoneRaw);
  const input = bodyText.trim();
  const upper = input.toUpperCase();
  const domain = (process.env.REPLIT_DOMAINS ?? "").split(",").filter(Boolean)[0]
    ?? process.env.REPLIT_DEV_DOMAIN
    ?? null;

  // ── Load or create session ─────────────────────────────────────────────────
  let [session] = await db
    .select()
    .from(waOnboardingSessionsTable)
    .where(eq(waOnboardingSessionsTable.phone, phoneNorm))
    .limit(1);

  // If session is expired, delete it and start fresh.
  // Track whether the user had previously made progress (LGPD accepted) so
  // we can send a warmer "welcome back" message on greeting inputs.
  let hadPreviousProgress = false;
  if (session && session.expires_at < new Date()) {
    hadPreviousProgress = session.lgpd_accepted;
    await db
      .delete(waOnboardingSessionsTable)
      .where(eq(waOnboardingSessionsTable.id, session.id));
    session = undefined as unknown as typeof session;
    log.info({ phone: phoneNorm, hadPreviousProgress }, "wa-onboarding: expired session cleared");
  }

  if (!session) {
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    [session] = await db
      .insert(waOnboardingSessionsTable)
      .values({
        phone: phoneNorm,
        step: "WELCOME",
        data: {},
        lgpd_accepted: false,
        expires_at: expiresAt,
      })
      .returning();
    log.info({ phone: phoneNorm }, "wa-onboarding: new session created");

    // If the user had a previous session that expired and they're sending a
    // casual greeting ("oi", "olá", etc.), reply with a warm re-entry message
    // instead of the generic LGPD banner so the context switch feels natural.
    if (hadPreviousProgress && isOnboardingRestartGreeting(input)) {
      return { kind: "wa_onboarding", phone: phoneRaw, reply: replyWarmRestart() };
    }
  }

  const currentStep = session.step as WaOnboardingStep;

  // ── State machine ──────────────────────────────────────────────────────────

  // WELCOME: gate on ACEITO
  if (currentStep === "WELCOME") {
    if (upper !== "ACEITO") {
      return { kind: "wa_onboarding", phone: phoneRaw, reply: replyWelcome() };
    }
    // Accept LGPD, advance
    await db
      .update(waOnboardingSessionsTable)
      .set({ lgpd_accepted: true, step: "NAME_CITY" })
      .where(eq(waOnboardingSessionsTable.id, session.id));
    return { kind: "wa_onboarding", phone: phoneRaw, reply: replyAskNameCity() };
  }

  // All subsequent steps require LGPD acceptance (defensive)
  if (!session.lgpd_accepted) {
    return { kind: "wa_onboarding", phone: phoneRaw, reply: replyLgpdRequired() };
  }

  // NAME_CITY
  if (currentStep === "NAME_CITY") {
    const parsed = parseNameCity(input);
    if (!parsed) {
      return { kind: "wa_onboarding", phone: phoneRaw, reply: replyUnknownInput("NAME_CITY") };
    }
    const updatedData: WaOnboardingData = {
      ...((session.data as WaOnboardingData) ?? {}),
      name: parsed.name,
      city: parsed.city,
    };
    await db
      .update(waOnboardingSessionsTable)
      .set({ step: "HOUSEHOLD_COMPOSITION", data: updatedData })
      .where(eq(waOnboardingSessionsTable.id, session.id));
    return { kind: "wa_onboarding", phone: phoneRaw, reply: replyAskComposition() };
  }

  // HOUSEHOLD_COMPOSITION
  if (currentStep === "HOUSEHOLD_COMPOSITION") {
    const { adults, children } = parseComposition(input);
    const updatedData: WaOnboardingData = {
      ...((session.data as WaOnboardingData) ?? {}),
      adults,
      children,
    };
    await db
      .update(waOnboardingSessionsTable)
      .set({ step: "RULE_TEMPLATES", data: updatedData })
      .where(eq(waOnboardingSessionsTable.id, session.id));
    return { kind: "wa_onboarding", phone: phoneRaw, reply: replyAskTemplates() };
  }

  // RULE_TEMPLATES
  if (currentStep === "RULE_TEMPLATES") {
    const selectedTemplates = parseTemplateSelection(input);
    const updatedData: WaOnboardingData = {
      ...((session.data as WaOnboardingData) ?? {}),
      selectedTemplates,
    };

    // Advance to COMPLETE in the session row
    await db
      .update(waOnboardingSessionsTable)
      .set({ step: "COMPLETE", data: updatedData })
      .where(eq(waOnboardingSessionsTable.id, session.id));

    // Create the actual account
    let userId: string;
    let magicToken: string;
    try {
      ({ userId, magicToken } = await createAccountFromSession(
        { phone: phoneNorm, data: updatedData },
        log,
      ));
    } catch (err) {
      log.error({ err, phone: phoneNorm }, "wa-onboarding: account creation failed");
      // Roll back to RULE_TEMPLATES so the user can retry
      await db
        .update(waOnboardingSessionsTable)
        .set({ step: "RULE_TEMPLATES" })
        .where(eq(waOnboardingSessionsTable.id, session.id));
      return {
        kind: "wa_onboarding",
        phone: phoneRaw,
        reply: "⚠️ Ocorreu um erro ao criar sua conta. Por favor, tente novamente.",
      };
    }

    // Store magic token + user id
    const magicExpires = new Date(Date.now() + MAGIC_TOKEN_TTL_MS);
    await db
      .update(waOnboardingSessionsTable)
      .set({
        created_user_id: userId,
        magic_token: magicToken,
        magic_token_expires_at: magicExpires,
      })
      .where(eq(waOnboardingSessionsTable.id, session.id));

    const name = (updatedData.name ?? "usuário");
    return {
      kind: "wa_onboarding",
      phone: phoneRaw,
      reply: replyComplete(name, magicToken, domain),
    };
  }

  // COMPLETE — user already onboarded, point them to the app
  if (currentStep === "COMPLETE") {
    const data = session.data as WaOnboardingData;
    const name = data.name ?? "usuário";
    if (session.magic_token && session.magic_token_expires_at && session.magic_token_expires_at > new Date()) {
      return {
        kind: "wa_onboarding",
        phone: phoneRaw,
        reply: replyComplete(name, session.magic_token, domain),
      };
    }
    // Token expired — just point to the app
    const appUrl = domain ? `https://${domain}/app` : null;
    const linkLine = appUrl ? `\n\nAcesse o app: ${appUrl}` : "";
    return {
      kind: "wa_onboarding",
      phone: phoneRaw,
      reply:
        `✅ Sua conta já está configurada, *${name}*!` +
        `${linkLine}\n\n` +
        `Encaminhe mensagens a qualquer momento — eu organizo tudo.`,
    };
  }

  // Fallback
  return { kind: "wa_onboarding", phone: phoneRaw, reply: replyWelcome() };
}

// ── Session expiry ────────────────────────────────────────────────────────────

/**
 * Purges expired onboarding sessions.
 * Called by the scheduler every hour.
 * Returns the count of deleted rows.
 */
export async function expireWaOnboardingSessions(): Promise<number> {
  const result = await db
    .delete(waOnboardingSessionsTable)
    .where(sql`${waOnboardingSessionsTable.expires_at} < NOW()`)
    .returning({ id: waOnboardingSessionsTable.id });
  return result.length;
}
