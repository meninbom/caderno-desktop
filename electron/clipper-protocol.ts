export const PAIR_TTL_MS = 120_000;
export const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface PairChallenge { code: string; nonce: string; expires: number }
export interface StoredClipperToken { token: string; origin: string; expiresAt: number }

export function isPairChallengeValid(pair: PairChallenge | null, code: unknown, nonce: unknown, now = Date.now()): pair is PairChallenge {
  return Boolean(pair && now < pair.expires && code === pair.code && nonce === pair.nonce);
}

export function isStoredTokenValid(value: unknown, now = Date.now()): value is StoredClipperToken {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<StoredClipperToken>;
  return typeof item.token === "string" && /^[a-f0-9]{64}$/.test(item.token)
    && typeof item.origin === "string" && /^chrome-extension:\/\/[a-p]{32}$/.test(item.origin)
    && typeof item.expiresAt === "number" && Number.isSafeInteger(item.expiresAt) && now < item.expiresAt;
}
