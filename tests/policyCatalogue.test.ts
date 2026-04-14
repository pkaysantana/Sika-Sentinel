/**
 * Policy Catalogue tests.
 *
 * These tests are the governance-side guardrails for Milestone 1A:
 *   - canonicalisation of JSON is order-independent and stable
 *   - version hashes change iff the catalogue semantics change
 *   - the default catalogue loads and parses under the live schema
 *   - evaluatePolicy interprets a caller-supplied catalogue correctly
 *   - policyVersion is threaded into every PolicyResult
 *   - rule-ordering / short-circuit behaviour matches the pre-catalogue engine
 *
 * These tests complement (and do not replace) the existing
 * `tests/policyEngine.test.ts`, which exercises the default catalogue against
 * the seven original rules.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  canonicaliseJson,
  hashCatalogue,
  parseCatalogue,
  loadCatalogue,
  reloadCatalogue,
  PolicyCatalogueSchema,
  type LoadedPolicyCatalogue,
  type PolicyCatalogue,
} from "../src/policy/catalogue";
import { evaluatePolicy } from "../src/policy/engine";
import type { Action } from "../src/schemas/action";
import type { ContextSnapshot } from "../src/context/loader";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeAction(overrides: Partial<Action> = {}): Action {
  return {
    correlationId: "cat-test",
    actionType: "HBAR_TRANSFER",
    actorId: "0.0.100",
    recipientId: "0.0.800",
    amountHbar: 5.0,
    rawInstruction: "Send 5 HBAR to 0.0.800",
    memo: "",
    ...overrides,
  };
}

function makeContext(overrides: Partial<ContextSnapshot> = {}): ContextSnapshot {
  return {
    actorId: "0.0.100",
    actorRole: "OPERATOR",
    partnerId: "partner-alpha",
    amountThresholdHbar: 100.0,
    approvedRecipients: ["0.0.800", "0.0.801"],
    treasuryPosture: "NORMAL",
    enforceRecipientAllowlist: true,
    ...overrides,
  };
}

/** A minimal two-rule catalogue used by several tests. */
function miniCatalogue(): PolicyCatalogue {
  return {
    schemaVersion: "1.0",
    name: "mini-test",
    description: "",
    rules: [
      {
        id: "X001",
        name: "RECIPIENT_PRESENT",
        description: "",
        appliesTo: ["HBAR_TRANSFER"],
        check: "RECIPIENT_PRESENT",
        decision: "DENIED",
        denialReason: "MISSING_RECIPIENT",
      },
      {
        id: "X002",
        name: "AMOUNT_VALID",
        description: "",
        appliesTo: ["HBAR_TRANSFER"],
        check: "AMOUNT_VALID",
        decision: "DENIED",
        denialReason: "INVALID_AMOUNT",
      },
    ],
  };
}

beforeEach(() => reloadCatalogue());

// ── canonicaliseJson ──────────────────────────────────────────────────────────

describe("canonicaliseJson", () => {
  it("sorts object keys recursively", () => {
    const a = canonicaliseJson({ b: 1, a: { d: 2, c: 3 } });
    const b = canonicaliseJson({ a: { c: 3, d: 2 }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("preserves array order (arrays are ordered data)", () => {
    const a = canonicaliseJson([1, 2, 3]);
    const b = canonicaliseJson([3, 2, 1]);
    expect(a).not.toBe(b);
  });

  it("handles null, undefined, primitives", () => {
    expect(canonicaliseJson(null)).toBe("null");
    expect(canonicaliseJson(undefined)).toBe("null");
    expect(canonicaliseJson(42)).toBe("42");
    expect(canonicaliseJson("x")).toBe('"x"');
    expect(canonicaliseJson(true)).toBe("true");
  });
});

// ── hashCatalogue ─────────────────────────────────────────────────────────────

describe("hashCatalogue", () => {
  it("produces a sha256:<hex> string", () => {
    const h = hashCatalogue(miniCatalogue());
    expect(h).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("is deterministic: same catalogue → same hash", () => {
    const a = hashCatalogue(miniCatalogue());
    const b = hashCatalogue(miniCatalogue());
    expect(a).toBe(b);
  });

  it("is stable under key reordering (cosmetic changes do not bump the hash)", () => {
    const forward = miniCatalogue();
    const reordered: PolicyCatalogue = {
      // same content, keys written in a different order
      rules: forward.rules.map((r) => ({
        denialReason: r.denialReason,
        decision: r.decision,
        check: r.check,
        appliesTo: r.appliesTo,
        description: r.description,
        name: r.name,
        id: r.id,
      })),
      description: forward.description,
      name: forward.name,
      schemaVersion: forward.schemaVersion,
    };
    expect(hashCatalogue(reordered)).toBe(hashCatalogue(forward));
  });

  it("changes when a rule's decision changes", () => {
    const base = miniCatalogue();
    const mutated = miniCatalogue();
    mutated.rules[0].decision = "APPROVAL_REQUIRED";
    expect(hashCatalogue(mutated)).not.toBe(hashCatalogue(base));
  });

  it("changes when rule order changes (order is semantically meaningful)", () => {
    const base = miniCatalogue();
    const reversed = miniCatalogue();
    reversed.rules.reverse();
    expect(hashCatalogue(reversed)).not.toBe(hashCatalogue(base));
  });
});

// ── parseCatalogue ────────────────────────────────────────────────────────────

describe("parseCatalogue", () => {
  it("rejects catalogues with duplicate rule IDs", () => {
    const bad = miniCatalogue();
    bad.rules[1].id = bad.rules[0].id;
    expect(() => parseCatalogue(bad)).toThrow(/duplicate rule id/i);
  });

  it("rejects rules that reference an unknown checker", () => {
    const bad = {
      ...miniCatalogue(),
      rules: [{ ...miniCatalogue().rules[0], check: "NOT_A_CHECKER" }],
    };
    expect(() => parseCatalogue(bad)).toThrow();
  });

  it("rejects catalogues missing required fields", () => {
    expect(() => parseCatalogue({})).toThrow();
  });

  it("produces a LoadedPolicyCatalogue with a version hash", () => {
    const loaded = parseCatalogue(miniCatalogue());
    expect(loaded.version).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(loaded.version).toBe(hashCatalogue(miniCatalogue()));
  });
});

// ── loadCatalogue (default on disk) ───────────────────────────────────────────

describe("loadCatalogue — default catalogue on disk", () => {
  it("loads policies/default.json and parses it with the live schema", () => {
    const loaded = loadCatalogue();
    expect(loaded.name).toBe("sika-sentinel-default");
    expect(loaded.rules.length).toBe(7);
    // Versions are deterministic per catalogue content, so we assert the prefix only.
    expect(loaded.version).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("is memoised until reloadCatalogue() is called", () => {
    const a = loadCatalogue();
    const b = loadCatalogue();
    expect(a).toBe(b); // same reference
    reloadCatalogue();
    const c = loadCatalogue();
    expect(c).not.toBe(a); // reference changed after reload
    expect(c.version).toBe(a.version); // but content is identical
  });

  it("default catalogue parses without errors under the live Zod schema", () => {
    const loaded = loadCatalogue();
    expect(() => PolicyCatalogueSchema.parse(loaded)).not.toThrow();
  });
});

// ── evaluatePolicy — catalogue interpretation ────────────────────────────────

describe("evaluatePolicy with an explicit catalogue", () => {
  let mini: LoadedPolicyCatalogue;

  beforeEach(() => {
    mini = parseCatalogue(miniCatalogue());
  });

  it("interprets the supplied catalogue (not the default)", () => {
    const result = evaluatePolicy(makeAction({ recipientId: "" }), makeContext(), mini);
    expect(result.decision).toBe("DENIED");
    expect(result.denialReason).toBe("MISSING_RECIPIENT");
    // The mini catalogue uses X001/X002 IDs, not R001/R002 — so the evaluated
    // trace must reflect the catalogue that was actually interpreted.
    expect(result.evaluatedRules).toEqual(["X001:RECIPIENT_PRESENT"]);
  });

  it("attaches the catalogue's version to every result", () => {
    const result = evaluatePolicy(makeAction(), makeContext(), mini);
    expect(result.policyVersion).toBe(mini.version);
  });

  it("short-circuits on the first rule that fires (preserving declaration order)", () => {
    const result = evaluatePolicy(
      makeAction({ recipientId: "", amountHbar: 0 }),
      makeContext(),
      mini
    );
    // X001 fires first → X002 is never checked.
    expect(result.denialReason).toBe("MISSING_RECIPIENT");
    expect(result.evaluatedRules).toEqual(["X001:RECIPIENT_PRESENT"]);
  });

  it("returns APPROVED with full rule trace when all applicable rules pass", () => {
    const result = evaluatePolicy(makeAction(), makeContext(), mini);
    expect(result.decision).toBe("APPROVED");
    expect(result.denialReason).toBeNull();
    expect(result.denialDetail).toBe("");
    expect(result.evaluatedRules).toEqual([
      "X001:RECIPIENT_PRESENT",
      "X002:AMOUNT_VALID",
    ]);
  });

  it("filters rules by appliesTo — a HBAR_TRANSFER-only rule is skipped for CHECK_BALANCE", () => {
    const result = evaluatePolicy(
      makeAction({ actionType: "CHECK_BALANCE", recipientId: "", amountHbar: 0 }),
      makeContext(),
      mini
    );
    // Neither X001 nor X002 apply to CHECK_BALANCE → nothing to evaluate → APPROVED.
    expect(result.decision).toBe("APPROVED");
    expect(result.evaluatedRules).toEqual([]);
  });
});

// ── Default catalogue: policyVersion is threaded through evaluatePolicy ──────

describe("evaluatePolicy with the default catalogue", () => {
  it("every result carries the default catalogue's version hash", () => {
    const expected = loadCatalogue().version;

    const approved = evaluatePolicy(makeAction(), makeContext());
    expect(approved.policyVersion).toBe(expected);

    const denied = evaluatePolicy(makeAction({ recipientId: "" }), makeContext());
    expect(denied.policyVersion).toBe(expected);

    const escalated = evaluatePolicy(
      makeAction({ amountHbar: 500 }),
      makeContext({ amountThresholdHbar: 100 })
    );
    expect(escalated.policyVersion).toBe(expected);
  });

  it("two evaluations with identical inputs return byte-identical policyVersion", () => {
    const a = evaluatePolicy(makeAction(), makeContext());
    const b = evaluatePolicy(makeAction(), makeContext());
    expect(a.policyVersion).toBe(b.policyVersion);
  });
});

// ── Checker parameter wiring ──────────────────────────────────────────────────

describe("rule parameters — ACTOR_AUTHORISED permittedRoles", () => {
  it("respects permittedRoles declared in the catalogue", () => {
    // A catalogue that permits only ADMIN (stripping OPERATOR/PARTNER from the default set).
    const adminOnly = parseCatalogue({
      schemaVersion: "1.0",
      name: "admin-only",
      description: "",
      rules: [
        {
          id: "A001",
          name: "ACTOR_AUTHORISED",
          description: "",
          appliesTo: ["HBAR_TRANSFER"],
          check: "ACTOR_AUTHORISED",
          decision: "DENIED",
          denialReason: "ACTOR_NOT_AUTHORISED",
          params: { permittedRoles: ["ADMIN"] },
        },
      ],
    });

    const operatorResult = evaluatePolicy(
      makeAction(),
      makeContext({ actorRole: "OPERATOR" }),
      adminOnly
    );
    expect(operatorResult.decision).toBe("DENIED");
    expect(operatorResult.denialReason).toBe("ACTOR_NOT_AUTHORISED");
    expect(operatorResult.denialDetail).toContain("OPERATOR");
    expect(operatorResult.denialDetail).toContain("ADMIN");

    const adminResult = evaluatePolicy(
      makeAction(),
      makeContext({ actorRole: "ADMIN", enforceRecipientAllowlist: false }),
      adminOnly
    );
    expect(adminResult.decision).toBe("APPROVED");
  });

  it("ACTOR_AUTHORISED throws if permittedRoles param is missing", () => {
    const broken = parseCatalogue({
      schemaVersion: "1.0",
      name: "broken",
      description: "",
      rules: [
        {
          id: "A001",
          name: "ACTOR_AUTHORISED",
          description: "",
          appliesTo: ["HBAR_TRANSFER"],
          check: "ACTOR_AUTHORISED",
          decision: "DENIED",
          denialReason: "ACTOR_NOT_AUTHORISED",
          // params intentionally omitted
        },
      ],
    });
    expect(() => evaluatePolicy(makeAction(), makeContext(), broken)).toThrow(
      /permittedRoles/
    );
  });
});
