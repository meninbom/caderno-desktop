import { describe, expect, it } from "vitest";
import { isPairChallengeValid, isStoredTokenValid, PAIR_TTL_MS, TOKEN_TTL_MS } from "../electron/clipper-protocol";

describe("Clipper protocol expiry", () => {
  it("expires the one-time pairing nonce after two minutes", () => {
    const now = 10_000;
    const pair = { code: "123456", nonce: "a".repeat(48), expires: now + PAIR_TTL_MS };
    expect(isPairChallengeValid(pair, "123456", pair.nonce, now)).toBe(true);
    expect(isPairChallengeValid(pair, "123456", pair.nonce, pair.expires)).toBe(false);
    expect(isPairChallengeValid(pair, "000000", pair.nonce, now)).toBe(false);
    expect(isPairChallengeValid(pair, "123456", "b".repeat(48), now)).toBe(false);
  });

  it("expires installation tokens after 30 days and rejects malformed records", () => {
    const now = 20_000;
    const record = { token: "a".repeat(64), origin: `chrome-extension://${"b".repeat(32)}`, expiresAt: now + TOKEN_TTL_MS };
    expect(isStoredTokenValid(record, now)).toBe(true);
    expect(isStoredTokenValid(record, record.expiresAt)).toBe(false);
    expect(isStoredTokenValid({ ...record, origin: "https://example.test" }, now)).toBe(false);
    expect(isStoredTokenValid({ ...record, token: "short" }, now)).toBe(false);
  });
});
