/**
 * Integrity tests — deterministic, no mocks.
 *
 * These tests verify that the policy engine's rule ordering and short-circuit
 * behaviour is correct and stable. They run without mocking any module so that
 * the exact implementation paths are exercised.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Action } from "../src/schemas/action";
import { evaluatePolicy, R001, R002, R003, R004, R005, R006, R007 } from "../src/policy/engine";
import { loadContext, reloadStore, setTreasuryPosture } from "../src/context/loader";

beforeEach(() => reloadStore());
afterEach(() => reloadStore());

function makeAction(overrides: Partial<Action> = {}): Action {
  return {
    correlationId: "integrity-test",
    actionType: "HBAR_TRANSFER",
    actorId: "0.0.100",
    recipientId: "0.0.800",
    amountHbar: 5.0,
    rawInstruction: "Send 5 HBAR to 0.0.800",
    memo: "",
    ...overrides,
  };
}

function ctx(actorId = "0.0.100") {
  return loadContext(actorId);
}

// ── Rule short-circuit ordering ───────────────────────────────────────────────

describe("rule ordering: R001 fires before all others", () => {
  it("blank recipient fires R001 even when treasury is FROZEN", () => {
    setTreasuryPosture("FROZEN");
    const result = evaluatePolicy(makeAction({ recipientId: "" }), ctx());
    expect(result.decision).toBe("DENIED");
    expect(result.denialReason).toBe("MISSING_RECIPIENT");
    expect(result.evaluatedRules).toEqual([R001]);
  });

  it("blank recipient fires R001 even when amount is invalid", () => {
    const result = evaluatePolicy(makeAction({ recipientId: "", amountHbar: -1 }), ctx());
    expect(result.decision).toBe("DENIED");
    expect(result.denialReason).toBe("MISSING_RECIPIENT");
    expect(result.evaluatedRules).toEqual([R001]);
  });
});

describe("rule ordering: R002 fires before R003–R007", () => {
  it("zero amount fires R002 even when recipient is unapproved", () => {
    const result = evaluatePolicy(makeAction({ amountHbar: 0, recipientId: "0.0.999" }), ctx());
    expect(result.decision).toBe("DENIED");
    expect(result.denialReason).toBe("INVALID_AMOUNT");
    expect(result.evaluatedRules).toContain(R002);
    expect(result.evaluatedRules).not.toContain(R005);
  });

  it("negative amount fires R002", () => {
    const result = evaluatePolicy(makeAction({ amountHbar: -0.001 }), ctx());
    expect(result.decision).toBe("DENIED");
    expect(result.denialReason).toBe("INVALID_AMOUNT");
  });
});

describe("rule ordering: R004 fires before R005", () => {
  it("FROZEN treasury fires R004 even when recipient is unapproved", () => {
    setTreasuryPosture("FROZEN");
    const result = evaluatePolicy(makeAction({ recipientId: "0.0.999" }), ctx());
    expect(result.decision).toBe("DENIED");
    expect(result.denialReason).toBe("TREASURY_FROZEN");
    expect(result.evaluatedRules).toContain(R004);
    expect(result.evaluatedRules).not.toContain(R005);
  });
});

describe("rule ordering: R005 fires before R006", () => {
  it("unapproved recipient fires R005 even when amount exceeds threshold", () => {
    // 0.0.100 threshold is 100 HBAR; send 200 to unapproved recipient
    const result = evaluatePolicy(makeAction({ recipientId: "0.0.999", amountHbar: 200 }), ctx());
    expect(result.decision).toBe("DENIED");
    expect(result.denialReason).toBe("RECIPIENT_NOT_APPROVED");
    expect(result.evaluatedRules).toContain(R005);
    expect(result.evaluatedRules).not.toContain(R006);
  });
});

describe("rule ordering: R006 fires before R007", () => {
  it("amount above threshold fires R006 even when treasury is RESTRICTED", () => {
    setTreasuryPosture("RESTRICTED");
    // Approved recipient but amount above threshold
    const result = evaluatePolicy(makeAction({ amountHbar: 200 }), ctx());
    expect(result.decision).toBe("APPROVAL_REQUIRED");
    expect(result.denialReason).toBe("AMOUNT_EXCEEDS_THRESHOLD");
    expect(result.evaluatedRules).toContain(R006);
    expect(result.evaluatedRules).not.toContain(R007);
  });
});

// ── evaluatedRules trace completeness ────────────────────────────────────────

describe("evaluatedRules trace", () => {
  it("APPROVED result includes all 7 rule IDs", () => {
    const result = evaluatePolicy(makeAction(), ctx());
    expect(result.evaluatedRules).toEqual([R001, R002, R003, R004, R005, R006, R007]);
  });

  it("R001 denial trace contains only R001", () => {
    const result = evaluatePolicy(makeAction({ recipientId: "" }), ctx());
    expect(result.evaluatedRules).toHaveLength(1);
    expect(result.evaluatedRules[0]).toBe(R001);
  });

  it("R005 denial trace contains R001..R005", () => {
    const result = evaluatePolicy(makeAction({ recipientId: "0.0.999" }), ctx());
    expect(result.evaluatedRules).toEqual([R001, R002, R003, R004, R005]);
  });
});

// ── Boundary conditions ───────────────────────────────────────────────────────

describe("amount threshold boundary", () => {
  it("amount exactly at threshold is APPROVED (not APPROVAL_REQUIRED)", () => {
    // 0.0.100 threshold is exactly 100 HBAR
    const result = evaluatePolicy(makeAction({ amountHbar: 100.0 }), ctx());
    expect(result.decision).toBe("APPROVED");
  });

  it("amount one unit above threshold triggers APPROVAL_REQUIRED", () => {
    const result = evaluatePolicy(makeAction({ amountHbar: 100.001 }), ctx());
    expect(result.decision).toBe("APPROVAL_REQUIRED");
  });

  it("PARTNER 0.0.200 threshold is 25 HBAR — 25 is approved", () => {
    const result = evaluatePolicy(
      makeAction({ actorId: "0.0.200", amountHbar: 25.0, recipientId: "0.0.800" }),
      loadContext("0.0.200"),
    );
    expect(result.decision).toBe("APPROVED");
  });

  it("PARTNER 0.0.200 — 25.001 HBAR requires approval", () => {
    const result = evaluatePolicy(
      makeAction({ actorId: "0.0.200", amountHbar: 25.001, recipientId: "0.0.800" }),
      loadContext("0.0.200"),
    );
    expect(result.decision).toBe("APPROVAL_REQUIRED");
  });
});

// ── Treasury posture transitions ──────────────────────────────────────────────

describe("treasury posture gate", () => {
  it("NORMAL → APPROVED for valid action", () => {
    const result = evaluatePolicy(makeAction(), ctx());
    expect(result.decision).toBe("APPROVED");
  });

  it("FROZEN → DENIED (TREASURY_FROZEN)", () => {
    setTreasuryPosture("FROZEN");
    const result = evaluatePolicy(makeAction(), ctx());
    expect(result.decision).toBe("DENIED");
    expect(result.denialReason).toBe("TREASURY_FROZEN");
  });

  it("RESTRICTED → MANUAL_REVIEW (after passing R001–R006)", () => {
    setTreasuryPosture("RESTRICTED");
    const result = evaluatePolicy(makeAction(), ctx());
    expect(result.decision).toBe("MANUAL_REVIEW");
    expect(result.denialReason).toBe("TREASURY_RESTRICTED");
  });
});

// ── Idempotency ───────────────────────────────────────────────────────────────

describe("idempotency", () => {
  it("evaluatePolicy called twice with same inputs returns identical result", () => {
    const action = makeAction();
    const context = ctx();
    const r1 = evaluatePolicy(action, context);
    const r2 = evaluatePolicy(action, context);
    expect(r1).toEqual(r2);
  });

  it("evaluatePolicy does not mutate the action", () => {
    const action = makeAction();
    const copy = { ...action };
    evaluatePolicy(action, ctx());
    expect(action).toEqual(copy);
  });
});

// ── enforceRecipientAllowlist=false bypass ────────────────────────────────────

describe("recipient allowlist enforcement flag", () => {
  it("ADMIN actor (enforceRecipientAllowlist=false) can send to any recipient", () => {
    // 0.0.300 is ADMIN with enforceRecipientAllowlist=false in the fallback store
    const context = loadContext("0.0.300");
    expect(context.enforceRecipientAllowlist).toBe(false);
    const result = evaluatePolicy(
      makeAction({ actorId: "0.0.300", recipientId: "0.0.77777" }),
      context,
    );
    expect(result.decision).toBe("APPROVED");
  });
});
