/**
 * In-memory store for WhatsApp onboarding verification tokens.
 *
 * Flow:
 *   1. POST /api/onboarding/whatsapp-connect  →  generates token, stores here
 *   2. User opens WA deep link, sends token to Twilio number
 *   3. Webhook receives message, calls markTokenVerified(token, senderPhone)
 *   4. GET /api/onboarding/whatsapp-status  →  polls isTokenVerified()
 *   5. POST /api/onboarding/complete calls getVerifiedPhone() to retrieve
 *      the confirmed phone — never trusts the client-supplied value.
 *
 * Tokens expire after 10 minutes and are auto-purged on access.
 * Single-instance safe (Replit runs one process per deployment).
 */

const TTL_MS = 10 * 60 * 1000; // 10 minutes

interface PendingToken {
  userId: string;
  householdId: number;
  verified: boolean;
  /** Set when the webhook confirms the token — the phone that actually sent it. */
  verifiedPhone: string | null;
  expiresAt: number;
}

const store = new Map<string, PendingToken>();

export function createToken(userId: string, householdId: number): string {
  // Clean up any expired tokens for this user first
  for (const [tok, entry] of store.entries()) {
    if (entry.userId === userId || Date.now() > entry.expiresAt) {
      store.delete(tok);
    }
  }

  // 6-digit suffix → 900 000 possibilities, making brute force impractical
  const digits = Math.floor(100000 + Math.random() * 900000);
  const token = `VESTA-${digits}`;
  store.set(token, {
    userId,
    householdId,
    verified: false,
    verifiedPhone: null,
    expiresAt: Date.now() + TTL_MS,
  });
  return token;
}

/**
 * Called by the webhook when it receives a VESTA-XXXXXX message.
 * Records which phone number sent the token so the server can bind the
 * verified number to the household — without relying on any client claim.
 * Returns the userId or null.
 */
export function markTokenVerified(token: string, senderPhone: string): string | null {
  const entry = store.get(token.trim().toUpperCase());
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(token);
    return null;
  }
  entry.verified = true;
  entry.verifiedPhone = senderPhone;
  return entry.userId;
}

export function isTokenVerified(userId: string): boolean {
  for (const [tok, entry] of store.entries()) {
    if (entry.userId === userId) {
      if (Date.now() > entry.expiresAt) {
        store.delete(tok);
        return false;
      }
      return entry.verified;
    }
  }
  return false;
}

/**
 * Returns the phone number that was used to verify the token for this user,
 * or null if no verified token exists. Used by /onboarding/complete to
 * obtain the server-authoritative phone without trusting the client.
 */
export function getVerifiedPhone(userId: string): string | null {
  for (const [tok, entry] of store.entries()) {
    if (entry.userId === userId) {
      if (Date.now() > entry.expiresAt) {
        store.delete(tok);
        return null;
      }
      return entry.verified ? (entry.verifiedPhone ?? null) : null;
    }
  }
  return null;
}

/** Returns true if text looks like a Vesta verification token. */
export function looksLikeToken(text: string): boolean {
  return /^VESTA-\d{6}$/i.test(text.trim());
}
