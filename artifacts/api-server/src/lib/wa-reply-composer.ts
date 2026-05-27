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

/**
 * Sent when the user replies "sim" and the action is approved.
 */
export function replyApproved(title: string): string {
  const short = title.length > 60 ? title.substring(0, 57) + "…" : title;
  return `✅ Confirmado!\n\n*${short}*\n\nAdicionado ao seu Vesta.`;
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
 * Sent when the user says "desfazer" within the 30-minute undo window.
 */
export function replyUndone(title: string): string {
  const short = title.length > 60 ? title.substring(0, 57) + "…" : title;
  return `↩️ Desfeito!\n\n*${short}* foi removido.`;
}
