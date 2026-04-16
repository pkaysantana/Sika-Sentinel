/**
 * Intent Parser — LLM failure and retry tests.
 *
 * Isolated from intentParser.test.ts because these tests need `vi.mock` to
 * intercept the dynamic `await import("@langchain/openai")` inside
 * extractViaLlm. Vitest hoists `vi.mock` to the top of the module scope,
 * which is the only reliable way to intercept dynamic imports.
 *
 * Key invariant (current heuristic):
 *   needsLlm == true  ⟺  confidence < 0.75 for HBAR_TRANSFER
 *                     ⟺  both amount AND recipient are missing
 *                     ⟺  heuristic result has shouldProceed == false
 *
 *   Therefore, when LLM fails and we return the heuristic fallback:
 *     llmStatus = "failed"  (LLM failed AND result is blocked)
 *
 *   llmStatus = "fallback" (LLM failed, result still proceeds) is a valid
 *   contract value for future scenarios (e.g. different thresholds) but is
 *   not reachable through parseInstruction with the current heuristic.
 *
 * Instruction used: "move funds somewhere"
 *   - "move" matches TRANSFER_RE → HBAR_TRANSFER
 *   - no amount, no Hedera account ID → confidence = 0.5
 *   - needsLlm = true (0.5 < 0.75)
 *   - heuristic blocks (both fields missing) → shouldProceed = false
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseInstruction } from "../src/agents/intentParser";

// ── Hoisted mock for @langchain/openai ───────────────────────────────────────
//
// `vi.mock` is hoisted so it intercepts the dynamic import inside extractViaLlm.
// We expose `mockInvoke` so individual tests can control the return / throw.

type InvokeFn = () => Promise<unknown>;
let mockInvoke: InvokeFn = async () => { throw new Error("mock not configured"); };

vi.mock("@langchain/openai", () => ({
  ChatOpenAI: vi.fn().mockImplementation(() => ({
    withStructuredOutput: () => ({
      invoke: vi.fn().mockImplementation(() => mockInvoke()),
    }),
  })),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Instruction with confidence = 0.5 (both fields missing) — always triggers LLM. */
const LOW_CONF = "move funds somewhere";
const ACTOR = "0.0.8570111";
const NO_DELAY = async () => {};

/** Successful LLM response with both fields populated. */
const SUCCESS_RESPONSE = {
  actionType: "HBAR_TRANSFER" as const,
  recipientId: "0.0.8570146",
  amountHbar: 5,
  memo: "",
};

beforeEach(() => {
  process.env.OPENAI_API_KEY = "test-key";
});

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
  vi.clearAllMocks();
});

// ── LLM failure — 5xx ────────────────────────────────────────────────────────

describe("LLM failure — 5xx server error", () => {
  it("never throws when LLM fails with 500", async () => {
    mockInvoke = async () => { throw { status: 500, message: "Internal Server Error" }; };
    await expect(
      parseInstruction(LOW_CONF, ACTOR, { maxRetries: 0, delay: NO_DELAY })
    ).resolves.toBeDefined();
  });

  it("never throws when LLM fails with 503", async () => {
    mockInvoke = async () => { throw { status: 503, message: "Overloaded" }; };
    await expect(
      parseInstruction(LOW_CONF, ACTOR, { maxRetries: 0, delay: NO_DELAY })
    ).resolves.toBeDefined();
  });

  it('sets llmStatus "failed" when heuristic fallback is also blocked', async () => {
    mockInvoke = async () => { throw { status: 500, message: "down" }; };
    const r = await parseInstruction(LOW_CONF, ACTOR, { maxRetries: 0, delay: NO_DELAY });
    expect(r.llmStatus).toBe("failed");
    expect(r.shouldProceed).toBe(false);
  });

  it("appends LLM failure reason to parseErrors", async () => {
    mockInvoke = async () => { throw { status: 500, message: "provider down" }; };
    const r = await parseInstruction(LOW_CONF, ACTOR, { maxRetries: 0, delay: NO_DELAY });
    expect(r.parseErrors.some((e) => /LLM unavailable/i.test(e))).toBe(true);
  });

  it("returns deterministic heuristic result (parserMode=heuristic)", async () => {
    mockInvoke = async () => { throw { status: 502, message: "bad gateway" }; };
    const r = await parseInstruction(LOW_CONF, ACTOR, { maxRetries: 0, delay: NO_DELAY });
    expect(r.parserMode).toBe("heuristic");
  });

  it("heuristic action fields are deterministic on LLM failure", async () => {
    // Use an instruction where heuristic can extract amount (even if LLM would enrich recipient)
    mockInvoke = async () => { throw { status: 500, message: "down" }; };
    const r = await parseInstruction("transfer 7 HBAR to somewhere", ACTOR, {
      maxRetries: 0,
      delay: NO_DELAY,
    });
    // Heuristic finds amount=7 (confidence goes to 0.75, so needsLlm = false)
    // → LLM is never called → llmStatus stays "ok", parserMode = "heuristic"
    // This verifies determinism for the common partial-parse case.
    expect(r.parserMode).toBe("heuristic");
    expect(r.action.amountHbar).toBe(7);
    expect(r.llmStatus).toBe("ok"); // no LLM needed at this confidence level
  });
});

// ── LLM failure — 4xx (no retry) ────────────────────────────────────────────

describe("LLM failure — 4xx client error (no retry)", () => {
  it("never throws on 401 Unauthorized", async () => {
    mockInvoke = async () => { throw { status: 401, message: "Unauthorized" }; };
    await expect(
      parseInstruction(LOW_CONF, ACTOR, { maxRetries: 0, delay: NO_DELAY })
    ).resolves.toBeDefined();
  });

  it('sets llmStatus "failed" on 401 (heuristic is also blocked)', async () => {
    mockInvoke = async () => { throw { status: 401, message: "Unauthorized" }; };
    const r = await parseInstruction(LOW_CONF, ACTOR, { maxRetries: 0, delay: NO_DELAY });
    expect(r.llmStatus).toBe("failed");
  });

  it("never throws on 429 rate limit", async () => {
    mockInvoke = async () => { throw { status: 429, message: "Too Many Requests" }; };
    await expect(
      parseInstruction(LOW_CONF, ACTOR, { maxRetries: 2, delay: NO_DELAY })
    ).resolves.toBeDefined();
  });

  it("does not retry on 4xx (mock called exactly once)", async () => {
    let calls = 0;
    mockInvoke = async () => { calls++; throw { status: 400, message: "Bad Request" }; };
    await parseInstruction(LOW_CONF, ACTOR, { maxRetries: 2, delay: NO_DELAY });
    expect(calls).toBe(1);
  });
});

// ── LLM retry — 5xx then success ────────────────────────────────────────────

describe("LLM retry — succeeds after one 5xx", () => {
  it('returns llmStatus "ok" when LLM eventually succeeds', async () => {
    let calls = 0;
    mockInvoke = async () => {
      calls++;
      if (calls === 1) throw { status: 503, message: "transient overload" };
      return SUCCESS_RESPONSE;
    };
    const r = await parseInstruction(LOW_CONF, ACTOR, { maxRetries: 1, delay: NO_DELAY });
    expect(r.llmStatus).toBe("ok");
    expect(r.parserMode).toBe("llm");
    expect(calls).toBe(2);
  });

  it("LLM success after retry yields correct action fields", async () => {
    let calls = 0;
    mockInvoke = async () => {
      calls++;
      if (calls === 1) throw { status: 500, message: "down" };
      return SUCCESS_RESPONSE;
    };
    const r = await parseInstruction(LOW_CONF, ACTOR, { maxRetries: 1, delay: NO_DELAY });
    expect(r.action.amountHbar).toBe(5);
    expect(r.action.recipientId).toBe("0.0.8570146");
    expect(r.shouldProceed).toBe(true);
  });

  it("retries exactly maxRetries times before giving up", async () => {
    let calls = 0;
    mockInvoke = async () => { calls++; throw { status: 500, message: "still down" }; };
    await parseInstruction(LOW_CONF, ACTOR, { maxRetries: 2, delay: NO_DELAY });
    expect(calls).toBe(3); // 1 initial + 2 retries
  });
});

// ── LLM success — happy path ─────────────────────────────────────────────────

describe("LLM success path", () => {
  it('sets llmStatus "ok" when LLM returns a valid result', async () => {
    mockInvoke = async () => SUCCESS_RESPONSE;
    const r = await parseInstruction(LOW_CONF, ACTOR, { maxRetries: 0, delay: NO_DELAY });
    expect(r.llmStatus).toBe("ok");
    expect(r.parserMode).toBe("llm");
  });

  it("LLM result fields are used when LLM succeeds", async () => {
    mockInvoke = async () => ({
      actionType: "HBAR_TRANSFER",
      recipientId: "0.0.1234",
      amountHbar: 99,
      memo: "test",
    });
    const r = await parseInstruction(LOW_CONF, ACTOR, { maxRetries: 0, delay: NO_DELAY });
    expect(r.action.recipientId).toBe("0.0.1234");
    expect(r.action.amountHbar).toBe(99);
  });
});
