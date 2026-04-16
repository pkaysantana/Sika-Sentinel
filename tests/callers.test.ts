/**
 * Caller store tests.
 *
 * Tests cover:
 *   - MemoryCallerStore: find, all
 *   - canActAs: wildcard, explicit list, empty list, missing actorId
 *   - verifySecret: correct, incorrect, empty inputs, constant-time path
 *   - hashSecret: deterministic output
 *   - dev caller helpers
 */

import { describe, it, expect } from "vitest";
import {
  canActAs,
  hashSecret,
  verifySecret,
  getDevCaller,
  DEV_CALLER_ID,
  createMemoryCallerStore,
} from "../src/auth/callers";
import type { CallerRecord } from "../src/auth/schemas";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRecord(overrides: Partial<CallerRecord> = {}): CallerRecord {
  return {
    id: "partner-alpha",
    kind: "service",
    name: "Partner Alpha",
    secretHash: hashSecret("correct-secret"),
    permittedActors: ["0.0.100", "0.0.101"],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── MemoryCallerStore ────────────────────────────────────────────────────────

describe("createMemoryCallerStore", () => {
  it("find returns record by id", () => {
    const store = createMemoryCallerStore([makeRecord()]);
    expect(store.find("partner-alpha")).not.toBeNull();
    expect(store.find("partner-alpha")?.id).toBe("partner-alpha");
  });

  it("find returns null for unknown id", () => {
    const store = createMemoryCallerStore([makeRecord()]);
    expect(store.find("unknown-id")).toBeNull();
  });

  it("all returns all records", () => {
    const records = [
      makeRecord({ id: "a" }),
      makeRecord({ id: "b" }),
    ];
    const store = createMemoryCallerStore(records);
    expect(store.all()).toHaveLength(2);
  });

  it("all returns empty array when store is empty", () => {
    const store = createMemoryCallerStore([]);
    expect(store.all()).toHaveLength(0);
  });
});

// ── canActAs ─────────────────────────────────────────────────────────────────

describe("canActAs", () => {
  it("allows explicit actor in permittedActors list", () => {
    const caller = makeRecord({ permittedActors: ["0.0.100"] });
    expect(canActAs(caller, "0.0.100")).toBe(true);
  });

  it("denies actor not in permittedActors list", () => {
    const caller = makeRecord({ permittedActors: ["0.0.100"] });
    expect(canActAs(caller, "0.0.200")).toBe(false);
  });

  it('wildcard "*" allows any actor', () => {
    const caller = makeRecord({ permittedActors: ["*"] });
    expect(canActAs(caller, "0.0.999")).toBe(true);
    expect(canActAs(caller, "0.0.100")).toBe(true);
  });

  it("empty permittedActors denies all", () => {
    const caller = makeRecord({ permittedActors: [] });
    expect(canActAs(caller, "0.0.100")).toBe(false);
  });

  it("denies when actorId is empty string", () => {
    const caller = makeRecord({ permittedActors: ["*"] });
    expect(canActAs(caller, "")).toBe(false);
  });

  it("allows the dev caller (wildcard) for any actor", () => {
    const dev = getDevCaller();
    expect(canActAs(dev, "0.0.100")).toBe(true);
    expect(canActAs(dev, "any-string")).toBe(true);
  });
});

// ── hashSecret ────────────────────────────────────────────────────────────────

describe("hashSecret", () => {
  it("returns a 64-char hex string (sha256)", () => {
    const h = hashSecret("my-secret");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    expect(hashSecret("same")).toBe(hashSecret("same"));
  });

  it("differs for different inputs", () => {
    expect(hashSecret("a")).not.toBe(hashSecret("b"));
  });
});

// ── verifySecret ─────────────────────────────────────────────────────────────

describe("verifySecret", () => {
  it("returns true when presented secret matches stored hash", () => {
    const stored = hashSecret("correct");
    expect(verifySecret("correct", stored)).toBe(true);
  });

  it("returns false when secret is wrong", () => {
    const stored = hashSecret("correct");
    expect(verifySecret("wrong", stored)).toBe(false);
  });

  it("returns false when presented secret is empty", () => {
    const stored = hashSecret("correct");
    expect(verifySecret("", stored)).toBe(false);
  });

  it("returns false when stored hash is empty", () => {
    expect(verifySecret("any-secret", "")).toBe(false);
  });

  it("returns false when both are empty", () => {
    expect(verifySecret("", "")).toBe(false);
  });

  it("never throws on arbitrary input", () => {
    expect(() => verifySecret("x".repeat(1000), "not-a-hash")).not.toThrow();
  });
});

// ── Dev caller ───────────────────────────────────────────────────────────────

describe("dev caller", () => {
  it("has id === DEV_CALLER_ID", () => {
    expect(getDevCaller().id).toBe(DEV_CALLER_ID);
  });

  it("has kind === dev", () => {
    expect(getDevCaller().kind).toBe("dev");
  });

  it('has permittedActors ["*"]', () => {
    expect(getDevCaller().permittedActors).toEqual(["*"]);
  });

  it("has empty secretHash (no credential required)", () => {
    expect(getDevCaller().secretHash).toBe("");
  });
});
