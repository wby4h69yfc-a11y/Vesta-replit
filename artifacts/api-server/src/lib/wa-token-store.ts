/**
 * In-memory store for WhatsApp onboarding verification tokens.
 *
 * Flow:
 *   1. POST /api/onboarding/whatsapp-connect  →  generates token, stores here
 *   2. User opens WA deep link, sends token to Twilio number
 *   3. Webhook receives message, calls markTokenVerified()
 *   4. GET /api/onboarding/whatsapp-status  →  polls isTokenVerified()
 *
 * Tokens expire after 10 minutes and are auto-purged on access.
 * Single-instance safe (Replit runs one process per deployment).
 */

const TTL_MS = 10 * 60 * 1000; // 10 minutes

interface PendingToken {
  userId: string;
  householdId: number;
  verified: boolean;
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

  const token = `VESTA-${Math.floor(100 + Math.random() * 900)}`;
  store.set(token, {
    userId,
    householdId,
    verified: false,
    expiresAt: Date.now() + TTL_MS,
  });
  return token;
}

/** Called by the webhook when it receives a VESTA-XXX message. Returns the userId or null. */
export function markTokenVerified(token: string): string | null {
  const entry = store.get(token.trim().toUpperCase());
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(token);
    return null;
  }
  entry.verified = true;
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

/** Returns true if text looks like a Vesta verification token. */
export function looksLikeToken(text: string): boolean {
  return /^VESTA-\d{3}$/i.test(text.trim());
}
