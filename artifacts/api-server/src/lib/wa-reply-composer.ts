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
