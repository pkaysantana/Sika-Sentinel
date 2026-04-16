/**
 * Auth middleware tests — resolveCaller() and authorizeActor().
 *
 * Tests are fully hermetic: no disk access, no env side-effects.
 * We inject a MemoryCallerStore and toggle isDevCallerAllowed by
 * setting/deleting process.env.SIKA_ALLOW_DEV_CALLER around each case.
 *
 * Covers:
 *   - Missing headers + dev allowed → dev-local caller
 *   - Missing headers + dev NOT allowed → 401
 *   - explicit dev-local id + dev allowed → dev-local caller
 *   - Unknown caller id → 401
 *   - Correct credentials → resolved caller
 *   - Wrong secret → 401
 *   - authorizeActor: success, wrong actor (403), auth failure propagated
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  resolveCaller,
  authorizeActor,
  CALLER_ID_HEADER,
  CALLER_SECRET_HEADER,
} from "../src/auth/middleware";
import {
  createMemoryCallerStore,
  hashSecret,
  DEV_CALLER_ID,
} from "../src/auth/callers";
import type { CallerRecord } from "../src/auth/schemas";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CORRECT_SECRET = "super-secret-123";

function makeRecord(overrides: Partial<CallerRecord> = {}): CallerRecord {
  return {
    id: "partner-alpha",
    kind: "service",
    name: "Partner Alpha",
    secretHash: hashSecret(CORRECT_SECRET),
    permittedActors: ["0.0.100"],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Build a minimal request-like object with the given headers. */
function fakeReq(headers: Record<string, string> = {}): { headers: { get(k: string): string | null } } {
  return {
    headers: {
      get(name: string) {
        return headers[name.toLowerCase()] ?? null;
      },
    },
  };
}

// ── Dev mode helpers ──────────────────────────────────────────────────────────

function enableDevMode() {
  process.env.SIKA_ALLOW_DEV_CALLER = "true";
}

function disableDevMode() {
  process.env.SIKA_ALLOW_DEV_CALLER = "false";
  process.env.NODE_ENV = "production";
}

function restoreDevMode() {
  delete process.env.SIKA_ALLOW_DEV_CALLER;
  delete (process.env as Record<string, string | undefined>).NODE_ENV;
}

// ── resolveCaller — dev mode ──────────────────────────────────────────────────

describe("resolveCaller — dev mode ON, no headers", () => {
  beforeEach(enableDevMode);
  afterEach(restoreDevMode);

  it("resolves to dev-local caller when headers are absent", () => {
    const result = resolveCaller(fakeReq(), createMemoryCallerStore([]));
    expect(result.ok).toBe(true);
    expect(result.ok && result.caller.id).toBe(DEV_CALLER_ID);
  });

  it("dev-local caller has kind=dev", () => {
    const result = resolveCaller(fakeReq(), createMemoryCallerStore([]));
    expect(result.ok && result.caller.kind).toBe("dev");
  });

  it('dev-local caller permits wildcard "*"', () => {
    const result = resolveCaller(fakeReq(), createMemoryCallerStore([]));
    expect(result.ok && result.caller.permittedActors).toContain("*");
  });

  it("explicit dev-local id also resolves to dev caller", () => {
    const req = fakeReq({ [CALLER_ID_HEADER]: DEV_CALLER_ID });
    const result = resolveCaller(req, createMemoryCallerStore([]));
    expect(result.ok).toBe(true);
    expect(result.ok && result.caller.id).toBe(DEV_CALLER_ID);
  });
});

// ── resolveCaller — dev mode OFF ────────────────────────────────────────────

describe("resolveCaller — dev mode OFF, no headers", () => {
  beforeEach(disableDevMode);
  afterEach(restoreDevMode);

  it("returns 401 when headers are absent", () => {
    const result = resolveCaller(fakeReq(), createMemoryCallerStore([]));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.status).toBe(401);
  });

  it("returns 401 when explicit dev-local id is presented", () => {
    const req = fakeReq({ [CALLER_ID_HEADER]: DEV_CALLER_ID });
    const result = resolveCaller(req, createMemoryCallerStore([]));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.status).toBe(401);
  });
});

// ── resolveCaller — known caller, correct secret ─────────────────────────────

describe("resolveCaller — valid credentials", () => {
  beforeEach(disableDevMode);
  afterEach(restoreDevMode);

  it("resolves to the caller when credentials are correct", () => {
    const store = createMemoryCallerStore([makeRecord()]);
    const req = fakeReq({
      [CALLER_ID_HEADER]: "partner-alpha",
      [CALLER_SECRET_HEADER]: CORRECT_SECRET,
    });
    const result = resolveCaller(req, store);
    expect(result.ok).toBe(true);
    expect(result.ok && result.caller.id).toBe("partner-alpha");
  });

  it("resolved caller carries permittedActors", () => {
    const store = createMemoryCallerStore([makeRecord()]);
    const req = fakeReq({
      [CALLER_ID_HEADER]: "partner-alpha",
      [CALLER_SECRET_HEADER]: CORRECT_SECRET,
    });
    const result = resolveCaller(req, store);
    expect(result.ok && result.caller.permittedActors).toContain("0.0.100");
  });
});

// ── resolveCaller — bad credentials ─────────────────────────────────────────

describe("resolveCaller — bad credentials", () => {
  beforeEach(disableDevMode);
  afterEach(restoreDevMode);

  it("returns 401 for unknown caller id", () => {
    const store = createMemoryCallerStore([makeRecord()]);
    const req = fakeReq({
      [CALLER_ID_HEADER]: "no-such-caller",
      [CALLER_SECRET_HEADER]: CORRECT_SECRET,
    });
    const result = resolveCaller(req, store);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.status).toBe(401);
  });

  it("returns 401 for wrong secret", () => {
    const store = createMemoryCallerStore([makeRecord()]);
    const req = fakeReq({
      [CALLER_ID_HEADER]: "partner-alpha",
      [CALLER_SECRET_HEADER]: "wrong-secret",
    });
    const result = resolveCaller(req, store);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.status).toBe(401);
  });

  it("error message does not leak stored hash or secret", () => {
    const store = createMemoryCallerStore([makeRecord()]);
    const req = fakeReq({
      [CALLER_ID_HEADER]: "partner-alpha",
      [CALLER_SECRET_HEADER]: "wrong-secret",
    });
    const result = resolveCaller(req, store);
    if (!result.ok) {
      expect(result.error).not.toContain(CORRECT_SECRET);
      expect(result.error).not.toContain(hashSecret(CORRECT_SECRET));
    }
  });
});

// ── authorizeActor ────────────────────────────────────────────────────────────

describe("authorizeActor", () => {
  beforeEach(disableDevMode);
  afterEach(restoreDevMode);

  it("returns ok=true when caller is permitted for actorId", () => {
    const store = createMemoryCallerStore([makeRecord()]);
    const req = fakeReq({
      [CALLER_ID_HEADER]: "partner-alpha",
      [CALLER_SECRET_HEADER]: CORRECT_SECRET,
    });
    const result = authorizeActor(req, "0.0.100", store);
    expect(result.ok).toBe(true);
  });

  it("returns 403 when caller is NOT permitted for actorId", () => {
    const store = createMemoryCallerStore([makeRecord()]);
    const req = fakeReq({
      [CALLER_ID_HEADER]: "partner-alpha",
      [CALLER_SECRET_HEADER]: CORRECT_SECRET,
    });
    const result = authorizeActor(req, "0.0.999", store);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.status).toBe(403);
  });

  it("403 error message names the caller and the requested actor", () => {
    const store = createMemoryCallerStore([makeRecord()]);
    const req = fakeReq({
      [CALLER_ID_HEADER]: "partner-alpha",
      [CALLER_SECRET_HEADER]: CORRECT_SECRET,
    });
    const result = authorizeActor(req, "0.0.999", store);
    expect(!result.ok && result.error).toContain("partner-alpha");
    expect(!result.ok && result.error).toContain("0.0.999");
  });

  it("propagates 401 when auth itself fails", () => {
    const store = createMemoryCallerStore([makeRecord()]);
    const req = fakeReq({ [CALLER_ID_HEADER]: "partner-alpha" /* no secret */ });
    const result = authorizeActor(req, "0.0.100", store);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.status).toBe(401);
  });

  it("dev caller is authorized for any actor when dev mode is on", () => {
    process.env.SIKA_ALLOW_DEV_CALLER = "true";
    const result = authorizeActor(fakeReq(), "0.0.anything", createMemoryCallerStore([]));
    expect(result.ok).toBe(true);
  });
});
