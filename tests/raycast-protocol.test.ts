import { describe, expect, it } from "vitest";
import {
  PAIR_CODE_ATTEMPTS,
  RAYCAST_PORT,
  hashRaycastToken,
  hasBrowserRequestHeaders,
  isAuthorizedToken,
  isLoopbackRequestAllowed,
  isPairChallengeValid,
  isValidEpochMilliseconds,
  resolveRaycastPort,
} from "../electron/raycast-protocol";

describe("Raycast local bridge protocol", () => {
  it("allows a distinct listener only through the explicit QA environment", () => {
    expect(resolveRaycastPort({} as NodeJS.ProcessEnv)).toBe(43188);
    expect(resolveRaycastPort({ CADERNO_QA_RAYCAST_PORT: "51234" } as NodeJS.ProcessEnv)).toBe(43188);
    expect(resolveRaycastPort({ CADERNO_QA_IPC: "1", CADERNO_QA_RAYCAST_PORT: "51234" } as NodeJS.ProcessEnv)).toBe(51234);
    expect(() => resolveRaycastPort({ CADERNO_QA_IPC: "1", CADERNO_QA_RAYCAST_PORT: "80" } as NodeJS.ProcessEnv)).toThrow(/between 1024 and 65535/);
  });

  it("accepts only a current ten digit pairing code within the attempt limit", () => {
    const pair = { code: "1234567890", expiresAt: 5_000, attempts: 0 };
    expect(isPairChallengeValid(pair, "1234567890", 4_999)).toBe(true);
    expect(isPairChallengeValid(pair, "1234567891", 4_999)).toBe(false);
    expect(isPairChallengeValid({ ...pair, attempts: PAIR_CODE_ATTEMPTS }, pair.code, 4_999)).toBe(false);
    expect(isPairChallengeValid(pair, pair.code, 5_000)).toBe(false);
    expect(isPairChallengeValid(pair, "123", 4_999)).toBe(false);
  });

  it("restricts requests to the exact IPv4 loopback host and peer", () => {
    expect(isLoopbackRequestAllowed(`127.0.0.1:${RAYCAST_PORT}`, "127.0.0.1")).toBe(true);
    expect(isLoopbackRequestAllowed(`127.0.0.1:${RAYCAST_PORT}`, "::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackRequestAllowed(`localhost:${RAYCAST_PORT}`, "127.0.0.1")).toBe(false);
    expect(isLoopbackRequestAllowed(`127.0.0.1:${RAYCAST_PORT + 1}`, "127.0.0.1")).toBe(false);
    expect(isLoopbackRequestAllowed(`127.0.0.1:${RAYCAST_PORT}`, "192.168.1.10")).toBe(false);
  });

  it("rejects browser-originated headers but accepts a native Raycast worker request", () => {
    expect(hasBrowserRequestHeaders({})).toBe(false);
    for (const name of ["origin", "referer", "sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest"]) {
      expect(hasBrowserRequestHeaders({ [name]: "http://127.0.0.1:5173" })).toBe(true);
    }
  });

  it("authorizes only a correctly formatted bearer whose hash matches", () => {
    const token = "ab".repeat(32);
    const other = "cd".repeat(32);
    expect(isAuthorizedToken(hashRaycastToken(token), `Bearer ${token}`)).toBe(true);
    expect(isAuthorizedToken(hashRaycastToken(token), `Bearer ${other}`)).toBe(false);
    expect(isAuthorizedToken(hashRaycastToken(token), token)).toBe(false);
    expect(isAuthorizedToken(hashRaycastToken(token), `Bearer ${token.toUpperCase()}`)).toBe(false);
    expect(isAuthorizedToken(null, `Bearer ${token}`)).toBe(false);
  });

  it("accepts only finite, safe epoch milliseconds representable by Date", () => {
    expect(isValidEpochMilliseconds(1_798_710_600_000)).toBe(true);
    expect(isValidEpochMilliseconds(-1)).toBe(true);
    expect(isValidEpochMilliseconds(8_640_000_000_000_000)).toBe(true);
    for (const value of ["1798710600000", true, false, Infinity, -Infinity, NaN, 1.5, Number.MAX_SAFE_INTEGER, 8_640_000_000_000_001, null, undefined]) {
      expect(isValidEpochMilliseconds(value)).toBe(false);
    }
  });
});
