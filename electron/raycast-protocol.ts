import crypto from "node:crypto";

export const DEFAULT_RAYCAST_PORT = 43188;

export function resolveRaycastPort(env: NodeJS.ProcessEnv = process.env): number {
  const requested = env.CADERNO_QA_RAYCAST_PORT;
  if (env.CADERNO_QA_IPC !== "1" || requested === undefined) return DEFAULT_RAYCAST_PORT;
  const port = Number(requested);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error("CADERNO_QA_RAYCAST_PORT must be an integer between 1024 and 65535.");
  }
  return port;
}

export const RAYCAST_PORT = resolveRaycastPort();
export const PAIR_CODE_TTL_MS = 3 * 60 * 1000;
export const PAIR_CODE_ATTEMPTS = 5;
export const RAYCAST_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Accept only exact epoch-millisecond values representable by JavaScript Date. */
export function isValidEpochMilliseconds(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && Number.isFinite(new Date(value).getTime());
}

export interface PairChallenge {
  code: string;
  expiresAt: number;
  attempts: number;
}

export function isLoopbackRequestAllowed(host: unknown, remoteAddress: unknown): boolean {
  return host === `127.0.0.1:${RAYCAST_PORT}`
    && (remoteAddress === "127.0.0.1" || remoteAddress === "::ffff:127.0.0.1");
}

/** Raycast's Node worker has no browser origin; reject browser initiated traffic. */
export function hasBrowserRequestHeaders(headers: Record<string, unknown>): boolean {
  return ["origin", "referer", "sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest"]
    .some(name => headers[name] !== undefined);
}

export function isPairChallengeValid(pair: PairChallenge | null, code: unknown, now = Date.now()): pair is PairChallenge {
  if (!pair || now >= pair.expiresAt || pair.attempts >= PAIR_CODE_ATTEMPTS || typeof code !== "string" || !/^\d{10}$/.test(code)) return false;
  const expected = Buffer.from(pair.code, "utf8");
  const actual = Buffer.from(code, "utf8");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export function hashRaycastToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export function isAuthorizedToken(expectedHash: string | null, authorization: unknown): boolean {
  if (!expectedHash || typeof authorization !== "string") return false;
  const match = /^Bearer ([a-f0-9]{64})$/.exec(authorization);
  if (!match) return false;
  const actual = Buffer.from(hashRaycastToken(match[1]), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

