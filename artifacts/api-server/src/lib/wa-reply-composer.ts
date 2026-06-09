/**
 * WhatsAppReplyComposer
 *
 * Formats all outbound Vesta → user WhatsApp messages.
 * All copy is in Brazilian Portuguese.
 *
 * Keep replies short and scannable — WhatsApp is not email.
 * Quick-reply buttons (BSP template) fall back to numbered text
 * when buttons aren't available on sandbox numbers.
 */

/**
 * Sent after a user completes the onboarding VESTA-XXX token flow.
 */
export function replyVerificationSuccess(firstName?: string | null): string {
  const greeting = firstName ? `Oi, ${firstName}! ` : "";
  return (
    `✅ ${greeting}WhatsApp verificado!\n\n` +
    `Pode começar a me encaminhar mensagens da casa — escola, consulta, boleto, diarista, o que for. ` +
    `Vou organizar tudo e te avisar quando precisar aprovar algo.`
  );
}

/**
 * Sent when an unrecognized or expired VESTA-XXX token arrives.
 */
export function replyTokenExpired(): string {
  return (
    "⚠️ Código não reconhecido ou expirado.\n\n" +
    "Abra o app Vesta e gere um novo código de verificação."
  );
}

/**
 * Sent immediately after a regular inbound message is received and queued.
 * Keep it short — just an acknowledgement.
 */
export function replyIngestAck(): string {
  return "✓ Recebi! Vou analisar e te avisar em breve.";
}

/**
 * Sent to the household admin when a high-stakes item requires explicit
 * review in the web app (payment, medical appointment, etc.).
 */
export function replyExplicitReviewNeeded(senderName: string): string {
  return (
    `📬 Nova mensagem de *${senderName}* aguarda revisão.\n\n` +
    `Acesse o Vesta para aprovar ou ajustar antes de confirmar.`
  );
}

/**
 * Sent when an item's confidence is too low or it's complex — user should
 * review in the app. Includes a deep link to the inbox.
 */
export function replyAppDeepLink(actionTitle: string | null, domain: string | null): string {
  const linkBase = domain ? `https://${domain}` : null;
  const appUrl = linkBase ? `${linkBase}/inbox` : null;
  const titlePart = actionTitle ? `*${actionTitle}*\n\n` : "";
  const linkPart = appUrl
    ? `Revise no app: ${appUrl}`
    : "Abra o app Vesta para revisar.";
  return `📋 ${titlePart}Precisa de uma revisão rápida antes de confirmar.\n${linkPart}`;
}

/**
 * Sent when an inbound message comes from an unknown phone number —
 * not stored in contacts or members for any household.
 * We do NOT send this reply in production (would confirm to spammers
 * the number is active). It's provided here for dev/test use only.
 */
export function replyUnknownSender(): string {
  return (
    "🔒 Número não reconhecido.\n\n" +
    "Se você pertence a uma família que usa o Vesta, peça ao administrador que adicione seu contato."
  );
}

/**
 * Sent when a contact's consent_status is not 'granted'.
 * We acknowledge receipt without leaking any household information.
 */
export function replyConsentRequired(): string {
  return (
    "Para receber mensagens da Vesta, o administrador da casa precisa autorizar seu contato primeiro."
  );
}

/**
 * Sent proactively to a diarista or external contact asking for explicit
 * LGPD consent to receive WhatsApp messages from Vesta.
 */
export function replyConsentRequest(householdName?: string | null): string {
  const from = householdName ? `a família *${householdName}*` : "uma família";
  return (
    `Olá! ${from} usa o aplicativo *Vesta* para organizar a rotina da casa e gostaria de enviar mensagens por WhatsApp.\n\n` +
    `Responda *SIM* para autorizar o recebimento de mensagens ou *NÃO* para recusar. ` +
    `Você pode revogar essa autorização a qualquer momento respondendo *REVOGAR*.\n\n` +
    `_Esta mensagem é enviada em conformidade com a LGPD (Lei 13.709/2018)._`
  );
}

/**
 * Sent to a diarista/contact after they reply "SIM" to the consent request.
 */
export function replyConsentGranted(): string {
  return (
    "✅ Autorização confirmada! A partir de agora você poderá receber mensagens da família pelo Vesta.\n\n" +
    "Para revogar a autorização a qualquer momento, responda *REVOGAR*."
  );
}

/**
 * Sent to a diarista/contact after they reply "NÃO" or "REVOGAR" to the consent request.
 */
export function replyConsentRevoked(): string {
  return (
    "🔒 Autorização recusada. Você não receberá mais mensagens da família pelo Vesta.\n\n" +
    "Se mudar de ideia, peça ao administrador da casa para enviar um novo convite."
  );
}

/**
 * Sent to the household admin when a diarista/contact accepts (replies "SIM").
 */
export function notifyAdminConsentGranted(contactName: string): string {
  return `✅ *${contactName}* autorizou mensagens pelo Vesta.`;
}

/**
 * Sent to the household admin when a diarista/contact declines or revokes consent
 * (replies "NÃO" or "REVOGAR").
 */
export function notifyAdminConsentRevoked(contactName: string): string {
  return `🔒 *${contactName}* recusou/revogou a autorização.`;
}

// ── Action proposal & approval replies ───────────────────────────────────────

const CATEGORY_EMOJI: Record<string, string> = {
  escola: "📚",
  saude: "🏥",
  financeiro: "💰",
  diarista: "🧹",
  compras: "🛒",
  lazer: "🎉",
  outros: "📋",
};

const TYPE_LABEL: Record<string, string> = {
  event: "Evento",
  task: "Tarefa",
  reminder: "Lembrete",
  purchase: "Compra",
};

function catEmoji(category: string | null): string {
  return CATEGORY_EMOJI[category ?? ""] ?? "📋";
}

function typeLabel(type: string | null): string {
  return TYPE_LABEL[type ?? ""] ?? "Item";
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Sent to the sender right after their message is classified.
 * Shows what Vesta understood and asks for a one-tap confirmation.
 * Keep it short — this appears as a chat message, not an email.
 */
export function replyActionProposal(
  title: string,
  type: string | null,
  category: string | null,
  datetime: string | null,
): string {
  const emoji = catEmoji(category);
  const label = typeLabel(type);
  const cat = category ? capitalize(category) : null;
  const meta = cat ? `${label} · ${cat}` : label;

  const lines: string[] = [
    `${emoji} *${title}*`,
    meta,
  ];

  if (datetime) {
    lines.push(datetime);
  }

  lines.push(
    "",
    "*sim* confirmar  ·  *não* descartar",
    "ou *editar: [nova versão]* para corrigir",
  );

  return lines.join("\n");
}

// Vocabulary pool for approval confirmations — rotated deterministically.
// Per spec §20.7: vary confirmations, never repeat the same word.
const APPROVAL_WORDS = ["Beleza", "Anotado", "Feito", "Pronto", "Confirmado"] as const;
let approvalWordIdx = 0;

function nextApprovalWord(): string {
  const word = APPROVAL_WORDS[approvalWordIdx % APPROVAL_WORDS.length]!;
  approvalWordIdx = (approvalWordIdx + 1) % APPROVAL_WORDS.length;
  return word;
}

/**
 * Sent when the user replies "sim" and the action is approved.
 * Rotates confirmation vocabulary per §20.7 style guide.
 */
export function replyApproved(title: string): string {
  const short = title.length > 60 ? title.substring(0, 57) + "…" : title;
  const word = nextApprovalWord();
  return `✅ ${word}!\n\n*${short}*\n\nAdicionado ao seu Vesta.`;
}

/**
 * Sent when the user replies "não" and the action is dismissed.
 */
export function replyDismissed(): string {
  return "🗑️ Descartado. Me avise se quiser registrar de outro jeito.";
}

/**
 * Sent when the user replies with an edit and the action is corrected.
 */
export function replyEdited(newTitle: string): string {
  const short = newTitle.length > 60 ? newTitle.substring(0, 57) + "…" : newTitle;
  return `✅ Atualizado e confirmado!\n\n*${short}*`;
}

/**
 * Sent when the user says "editar" without content — prompts them to
 * describe what they want to change.
 */
export function replyEditPrompt(): string {
  return "✏️ O que você quer mudar? Me diga e eu atualizo antes de confirmar.";
}

/**
 * Sent after applying a natural-language inline edit — re-proposes the
 * updated item for final confirmation.
 */
export function replyNlEditProposal(newTitle: string): string {
  const short = newTitle.length > 60 ? newTitle.substring(0, 57) + "…" : newTitle;
  return (
    `✏️ Atualizado: *${short}*\n\n` +
    `*sim* confirmar  ·  *não* descartar`
  );
}

/**
 * Sent when the user says "desfazer" within the 30-minute undo window.
 */
export function replyUndone(title: string): string {
  const short = title.length > 60 ? title.substring(0, 57) + "…" : title;
  return `↩️ Desfeito!\n\n*${short}* foi removido.`;
}

// ── Provider rating messages ───────────────────────────────────────────────────

/**
 * Sent to the household admin after a service interaction.
 * Asks them to rate the provider. The reply is caught by the WA processor.
 */
export function replyRatingRequest(providerName: string): string {
  return (
    `⭐ Como foi com *${providerName}*?\n\n` +
    `Responda:\n*Bom* · *Ok* · *Ruim* · *Não apareceu*`
  );
}

/**
 * Sent after admin rates a provider "bom".
 */
export function replyRatingBom(providerName: string): string {
  return `✅ Anotado! *${providerName}* recebeu uma avaliação positiva.`;
}

/**
 * Sent after admin rates "ok" (neutral).
 */
export function replyRatingOk(providerName: string): string {
  return `👍 Anotado! Avaliação de *${providerName}* registrada.`;
}

/**
 * Sent after admin rates "ruim" — asks for confirmation before marking as avoid.
 */
export function replyRatingRuim(providerName: string): string {
  return (
    `⚠️ Avaliação negativa registrada para *${providerName}*.\n\n` +
    `Deseja adicioná-lo à lista de *Evitar*? Responda *Sim* para confirmar.`
  );
}

/**
 * Sent after admin reports a no-show.
 * When noShowCount >= 2, asks for confirmation before marking as avoid.
 */
export function replyRatingNoShow(providerName: string, noShowCount: number): string {
  const extra =
    noShowCount >= 2
      ? `\n\n⚠️ Já foram ${noShowCount} faltas. Deseja marcar *${providerName}* como *Evitar*? Responda *Sim* para confirmar.`
      : "";
  return `🚫 Falta registrada para *${providerName}*.${extra}`;
}

/**
 * Sent when the admin confirms promoting a provider to "preferred".
 */
export function replyPreferredPromoted(providerName: string): string {
  return `⭐ *${providerName}* foi marcado como *Preferido*. Ótima escolha!`;
}

/**
 * Sent when the admin declines the preferred-upgrade suggestion.
 */
export function replyPreferredDeclined(providerName: string): string {
  return `👍 Ok! *${providerName}* mantido como está.`;
}

/**
 * Sent when the admin confirms the "avoid" marking.
 */
export function replyAvoidConfirmed(providerName: string): string {
  return (
    `✅ *${providerName}* foi adicionado à lista de *Evitar*.\n\n` +
    `Você pode alterar isso nas configurações de contato.`
  );
}

/**
 * Sent when the admin declines the "avoid" marking.
 */
export function replyAvoidCancelled(providerName: string): string {
  return `👍 Ok! *${providerName}* mantido como estava.`;
}

/**
 * Sent to the admin when two consecutive "Bom" ratings suggest upgrading
 * the provider to Preferred.
 */
export function replyRatingSuggestPreferred(providerName: string): string {
  return (
    `🌟 *${providerName}* recebeu duas avaliações positivas seguidas!\n\n` +
    `Promover para *Preferido*? Responda *Sim* para confirmar.`
  );
}

// ── Mutation proposal replies ─────────────────────────────────────────────────

/**
 * Sent to the admin when a DM mutation command was executed successfully.
 * `description` is a short human-readable summary of what was done.
 */
export function replyMutationExecuted(description: string): string {
  const short = description.length > 80 ? description.substring(0, 77) + "…" : description;
  return `✅ Feito!\n\n${short}`;
}

/**
 * Sent to the admin when they reply "não" to a mutation proposal.
 */
export function replyMutationDismissed(): string {
  return "👍 Tudo bem, cancelei. Me avise se quiser fazer algo diferente.";
}

/**
 * Sent to the admin when a mutation proposal was created (sim/não prompt).
 * The `proposalText` is built by the mutation handler and already contains the
 * full proposal with the confirmation options — pass it through unchanged.
 */
export function replyMutationProposal(proposalText: string): string {
  return proposalText;
}

/**
 * Sent to the admin when the mutation handler cannot parse the command or
 * find the target entity — includes a friendly error message.
 */
export function replyMutationError(errorText: string): string {
  return errorText;
}

// ── Group /vesta command replies ──────────────────────────────────────────────

/**
 * Sent into a WhatsApp group when a non-admin member issues a /vesta command.
 * Only household admins may invoke Vesta from a group chat.
 */
export function replyGroupNonAdmin(): string {
  return "🔒 Só admins da Vesta podem usar esse comando.";
}

/**
 * Sent into a WhatsApp group when an admin issues a mutation command
 * (/vesta cancela…, /vesta cria…, etc.) in a group thread.
 * Mutation commands require the full multi-turn approval loop which is only
 * safe in a private DM — bystanders in a group could read proposals or
 * accidentally trigger approvals.
 */
export function replyGroupMutationBlocked(): string {
  return (
    "⚠️ Comandos de alteração precisam ser enviados em mensagem direta para mim.\n\n" +
    "No chat privado você pode criar, cancelar ou editar itens com segurança. " +
    "Aqui no grupo só respondo perguntas sobre agenda, tarefas e caixa de entrada. 📱"
  );
}

/**
 * Sent when a preferred provider is relevant to a new task or cascade.
 */
export function replyPreferredProviderSuggestion(
  providerName: string,
  rating: number | null,
  lastPriceRange: string | null,
): string {
  const stars = rating ? "⭐".repeat(Math.min(5, Math.max(1, rating))) : "";
  const price = lastPriceRange ? ` · ${lastPriceRange}` : "";
  return (
    `💡 Você usou *${providerName}* da última vez${stars ? ` (${stars}${price})` : ""}.\n` +
    `Deseja chamar novamente?`
  );
}
