import { describe, it, expect, beforeEach } from "vitest";
import { parseInstruction } from "../src/agents/intentParser";

// No LLM keys — all tests use heuristic path
beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});

// ── ParseResult shape ─────────────────────────────────────────────────────────

describe("ParseResult shape", () => {
  it("returns parserMode, confidence, parseErrors, workflowContext, action", async () => {
    const r = await parseInstruction("Send 5 HBAR to 0.0.8570146", "0.0.8570111");
    expect(r.parserMode).toBeDefined();
    expect(typeof r.confidence).toBe("number");
    expect(Array.isArray(r.parseErrors)).toBe(true);
    expect(r.workflowContext).toBeDefined();
    expect(r.action).toBeDefined();
  });

  it("returns shouldProceed, parseWarnings, clarificationMessage", async () => {
    const r = await parseInstruction("Send 5 HBAR to 0.0.8570146", "0.0.8570111");
    expect(typeof r.shouldProceed).toBe("boolean");
    expect(Array.isArray(r.parseWarnings)).toBe(true);
    expect(r.clarificationMessage === null || typeof r.clarificationMessage === "string").toBe(true);
  });

  it("always returns heuristic mode when no API key is set", async () => {
    const r = await parseInstruction("Send 5 HBAR to 0.0.800", "0.0.100");
    expect(r.parserMode).toBe("heuristic");
  });
});

// ── HBAR_TRANSFER intent ──────────────────────────────────────────────────────

describe("HBAR_TRANSFER intent", () => {
  it("detects 'send' keyword", async () => {
    const r = await parseInstruction("Send 5 HBAR to 0.0.8570146", "0.0.8570111");
    expect(r.action.actionType).toBe("HBAR_TRANSFER");
    expect(r.workflowContext.detectedIntent).toBe("HBAR_TRANSFER");
  });

  it("detects 'transfer' keyword", async () => {
    const r = await parseInstruction("Transfer 10 HBAR to 0.0.8570146", "0.0.8570111");
    expect(r.action.actionType).toBe("HBAR_TRANSFER");
  });

  it("detects 'pay' keyword", async () => {
    const r = await parseInstruction("Pay 200 HBAR to 0.0.8570146", "0.0.8570111");
    expect(r.action.actionType).toBe("HBAR_TRANSFER");
  });

  it("extracts correct HBAR amount", async () => {
    const r = await parseInstruction("Send 12.5 HBAR to 0.0.8570146", "0.0.8570111");
    expect(r.action.amountHbar).toBe(12.5);
    expect(r.workflowContext.extractedAmount).toBe(12.5);
  });

  it("extracts recipient account (not actor)", async () => {
    const r = await parseInstruction("Send 5 HBAR to 0.0.8570146", "0.0.8570111");
    expect(r.action.recipientId).toBe("0.0.8570146");
    expect(r.workflowContext.extractedRecipient).toBe("0.0.8570146");
  });

  it("skips actor ID when finding recipient", async () => {
    const r = await parseInstruction(
      "0.0.8570111 wants to send 5 HBAR to 0.0.8570146",
      "0.0.8570111"
    );
    expect(r.action.recipientId).toBe("0.0.8570146");
  });

  it("produces high confidence when both amount and recipient present", async () => {
    const r = await parseInstruction("Send 5 HBAR to 0.0.8570146", "0.0.8570111");
    expect(r.confidence).toBe(1.0);
    expect(r.parseErrors).toHaveLength(0);
  });

  it("produces medium confidence when only amount present", async () => {
    const r = await parseInstruction("Send 5 HBAR to someone", "0.0.8570111");
    expect(r.confidence).toBeLessThan(0.8);
    expect(r.parseErrors.some((e) => e.includes("recipient"))).toBe(true);
  });

  it("produces medium confidence when only recipient present", async () => {
    const r = await parseInstruction("send something to 0.0.8570146", "0.0.8570111");
    expect(r.confidence).toBeLessThan(0.8);
    expect(r.parseErrors.some((e) => e.includes("amount"))).toBe(true);
  });

  it("produces low confidence when neither amount nor recipient found", async () => {
    const r = await parseInstruction("please do the thing", "0.0.8570111");
    expect(r.confidence).toBeLessThan(0.6);
    expect(r.parseErrors.length).toBeGreaterThan(0);
  });

  it("preserves rawInstruction", async () => {
    const raw = "Send 5 HBAR to 0.0.8570146";
    const r = await parseInstruction(raw, "0.0.8570111");
    expect(r.action.rawInstruction).toBe(raw);
    expect(r.workflowContext.rawInstruction).toBe(raw);
  });

  it("generates a correlationId", async () => {
    const r = await parseInstruction("Send 5 HBAR to 0.0.8570146", "0.0.8570111");
    expect(r.action.correlationId).toBeTruthy();
  });
});

// ── CHECK_BALANCE intent ──────────────────────────────────────────────────────

describe("CHECK_BALANCE intent", () => {
  it("detects 'check balance'", async () => {
    const r = await parseInstruction("Check my balance", "0.0.8570111");
    expect(r.action.actionType).toBe("CHECK_BALANCE");
    expect(r.workflowContext.detectedIntent).toBe("CHECK_BALANCE");
  });

  it("detects 'how much HBAR do I have'", async () => {
    const r = await parseInstruction("How much HBAR do I have?", "0.0.8570111");
    expect(r.action.actionType).toBe("CHECK_BALANCE");
  });

  it("detects 'what is my balance'", async () => {
    const r = await parseInstruction("What is my balance?", "0.0.8570111");
    expect(r.action.actionType).toBe("CHECK_BALANCE");
  });

  it("defaults amountHbar to 0 for balance check", async () => {
    const r = await parseInstruction("Check my balance", "0.0.8570111");
    expect(r.action.amountHbar).toBe(0);
  });

  it("defaults recipientId to empty string for balance check", async () => {
    const r = await parseInstruction("Check my balance", "0.0.8570111");
    expect(r.action.recipientId).toBe("");
  });

  it("produces confidence ≥ 0.75 for balance intent", async () => {
    const r = await parseInstruction("Check my balance", "0.0.8570111");
    expect(r.confidence).toBeGreaterThanOrEqual(0.75);
  });

  it("produces no parse errors for a clean balance check", async () => {
    const r = await parseInstruction("Check my balance", "0.0.8570111");
    expect(r.parseErrors).toHaveLength(0);
  });
});

// ── workflowContext ───────────────────────────────────────────────────────────

describe("workflowContext", () => {
  it("lists all extracted account IDs", async () => {
    const r = await parseInstruction(
      "Send 5 HBAR from 0.0.8570111 to 0.0.8570146",
      "0.0.8570111"
    );
    expect(r.workflowContext.extractedAccounts).toContain("0.0.8570111");
    expect(r.workflowContext.extractedAccounts).toContain("0.0.8570146");
  });

  it("extractedAmount is null when no amount found", async () => {
    const r = await parseInstruction("send to 0.0.8570146", "0.0.8570111");
    expect(r.workflowContext.extractedAmount).toBeNull();
  });

  it("extractedRecipient is null when none found", async () => {
    const r = await parseInstruction("Send 5 HBAR to someone", "0.0.8570111");
    expect(r.workflowContext.extractedRecipient).toBeNull();
  });
});

// ── shouldProceed / ambiguity handling ────────────────────────────────────────

describe("shouldProceed and ambiguity handling", () => {
  // High confidence — proceed
  it("shouldProceed is true when both amount and recipient are present", async () => {
    const r = await parseInstruction("Send 5 HBAR to 0.0.8570146", "0.0.8570111");
    expect(r.shouldProceed).toBe(true);
    expect(r.clarificationMessage).toBeNull();
  });

  it("parseWarnings is empty for a high-confidence parse", async () => {
    const r = await parseInstruction("Send 5 HBAR to 0.0.8570146", "0.0.8570111");
    expect(r.parseWarnings).toHaveLength(0);
  });

  // Medium confidence — proceed with warnings
  it("shouldProceed is true but parseWarnings non-empty when only amount is present", async () => {
    const r = await parseInstruction("Send 5 HBAR to someone", "0.0.8570111");
    // confidence = 0.75 (base 0.5 + amount 0.25) — medium, still proceeds
    expect(r.shouldProceed).toBe(true);
    expect(r.parseWarnings.length).toBeGreaterThan(0);
    expect(r.clarificationMessage).toBeNull();
  });

  // Low confidence — block
  it("shouldProceed is false when neither amount nor recipient are present", async () => {
    const r = await parseInstruction("please do the thing", "0.0.8570111");
    expect(r.shouldProceed).toBe(false);
    expect(r.clarificationMessage).not.toBeNull();
  });

  it("clarificationMessage is set when both amount and recipient are missing", async () => {
    const r = await parseInstruction("please do the thing", "0.0.8570111");
    expect(r.clarificationMessage).toMatch(/missing/i);
  });

  it("shouldProceed is false for vague transfer instructions", async () => {
    const r = await parseInstruction("send money", "0.0.8570111");
    expect(r.shouldProceed).toBe(false);
    expect(r.clarificationMessage).toMatch(/vague|specify|amount|recipient/i);
  });

  it("shouldProceed is false for 'pay them'", async () => {
    const r = await parseInstruction("pay them", "0.0.8570111");
    expect(r.shouldProceed).toBe(false);
    expect(r.clarificationMessage).not.toBeNull();
  });

  // CHECK_BALANCE — not blocked by missing transfer fields
  it("shouldProceed is true for a clean balance check", async () => {
    const r = await parseInstruction("Check my balance", "0.0.8570111");
    expect(r.shouldProceed).toBe(true);
    expect(r.clarificationMessage).toBeNull();
  });

  it("clarificationMessage is null for CHECK_BALANCE", async () => {
    const r = await parseInstruction("What is my balance?", "0.0.8570111");
    expect(r.clarificationMessage).toBeNull();
  });

  // Missing recipient only — proceed with warning (confidence = 0.75)
  it("missing recipient only attaches warning but still proceeds", async () => {
    const r = await parseInstruction("Send 5 HBAR to someone", "0.0.8570111");
    expect(r.shouldProceed).toBe(true);
    expect(r.parseWarnings.some((w) => /recipient/i.test(w))).toBe(true);
  });
});

// ── llmStatus ─────────────────────────────────────────────────────────────────

describe("llmStatus — heuristic path (no LLM key)", () => {
  it('is "ok" for a high-confidence instruction', async () => {
    const r = await parseInstruction("Send 5 HBAR to 0.0.8570146", "0.0.8570111");
    expect(r.llmStatus).toBe("ok");
  });

  it('is "ok" for a blocked (low-confidence) instruction', async () => {
    const r = await parseInstruction("please do the thing", "0.0.8570111");
    expect(r.llmStatus).toBe("ok");
  });

  it('is "ok" for a balance check', async () => {
    const r = await parseInstruction("Check my balance", "0.0.8570111");
    expect(r.llmStatus).toBe("ok");
  });
});

// ── LLM failure fallback ──────────────────────────────────────────────────────
//
// We set an API key so parseInstruction enters the LLM branch, then mock
// @langchain/openai to simulate different failure modes. Tests verify:
//   - parseInstruction never throws
//   - deterministic heuristic result is returned
//   - llmStatus reflects failure/fallback distinction
//   - parseErrors contains the LLM failure reason
//   - retry budget is consumed before falling back (via retryOptions injection)

describe("LLM failure — 5xx server error (retries exhausted)", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
  });

  it("never throws when LLM fails with 5xx", async () => {
    vi.doMock("@langchain/openai", () => ({
      ChatOpenAI: vi.fn().mockImplementation(() => ({
        withStructuredOutput: () => ({
          invoke: vi.fn().mockRejectedValue({ status: 500, message: "Internal Server Error" }),
        }),
      })),
    }));
    await expect(
      parseInstruction("Send 5 HBAR to 0.0.8570146", "0.0.8570111", { maxRetries: 0, delay: async () => {} })
    ).resolves.toBeDefined();
    vi.doUnmock("@langchain/openai");
  });

  it('returns llmStatus "fallback" when heuristic result can proceed', async () => {
    vi.doMock("@langchain/openai", () => ({
      ChatOpenAI: vi.fn().mockImplementation(() => ({
        withStructuredOutput: () => ({
          invoke: vi.fn().mockRejectedValue({ status: 503, message: "Overloaded" }),
        }),
      })),
    }));
    // High-confidence instruction — heuristic would proceed
    const r = await parseInstruction(
      "Send 5 HBAR to 0.0.8570146",
      "0.0.8570111",
      { maxRetries: 0, delay: async () => {} }
    );
    expect(r.llmStatus).toBe("fallback");
    expect(r.shouldProceed).toBe(true);
    vi.doUnmock("@langchain/openai");
  });

  it('returns llmStatus "failed" when heuristic fallback is also blocked', async () => {
    vi.doMock("@langchain/openai", () => ({
      ChatOpenAI: vi.fn().mockImplementation(() => ({
        withStructuredOutput: () => ({
          invoke: vi.fn().mockRejectedValue({ status: 500, message: "Internal Server Error" }),
        }),
      })),
    }));
    // Low-confidence instruction — heuristic blocks, and LLM would have been needed
    const r = await parseInstruction(
      "send something somewhere",
      "0.0.8570111",
      { maxRetries: 0, delay: async () => {} }
    );
    expect(r.llmStatus).toBe("failed");
    expect(r.shouldProceed).toBe(false);
    vi.doUnmock("@langchain/openai");
  });

  it("appends LLM failure reason to parseErrors", async () => {
    vi.doMock("@langchain/openai", () => ({
      ChatOpenAI: vi.fn().mockImplementation(() => ({
        withStructuredOutput: () => ({
          invoke: vi.fn().mockRejectedValue({ status: 500, message: "provider down" }),
        }),
      })),
    }));
    const r = await parseInstruction(
      "Send 5 HBAR to 0.0.8570146",
      "0.0.8570111",
      { maxRetries: 0, delay: async () => {} }
    );
    expect(r.parseErrors.some((e) => /LLM unavailable/i.test(e))).toBe(true);
    vi.doUnmock("@langchain/openai");
  });

  it("returns deterministic heuristic action fields on LLM failure", async () => {
    vi.doMock("@langchain/openai", () => ({
      ChatOpenAI: vi.fn().mockImplementation(() => ({
        withStructuredOutput: () => ({
          invoke: vi.fn().mockRejectedValue({ status: 500, message: "down" }),
        }),
      })),
    }));
    const r = await parseInstruction(
      "Send 10 HBAR to 0.0.9999",
      "0.0.8570111",
      { maxRetries: 0, delay: async () => {} }
    );
    // Heuristic should extract these correctly
    expect(r.action.amountHbar).toBe(10);
    expect(r.action.recipientId).toBe("0.0.9999");
    expect(r.parserMode).toBe("heuristic");
    vi.doUnmock("@langchain/openai");
  });
});

describe("LLM failure — 4xx client error (no retry)", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
  });

  it("never throws on 401 auth failure", async () => {
    vi.doMock("@langchain/openai", () => ({
      ChatOpenAI: vi.fn().mockImplementation(() => ({
        withStructuredOutput: () => ({
          invoke: vi.fn().mockRejectedValue({ status: 401, message: "Unauthorized" }),
        }),
      })),
    }));
    await expect(
      parseInstruction("Send 5 HBAR to 0.0.8570146", "0.0.8570111", { maxRetries: 0, delay: async () => {} })
    ).resolves.toBeDefined();
    vi.doUnmock("@langchain/openai");
  });

  it('sets llmStatus "fallback" on 401 when heuristic can proceed', async () => {
    vi.doMock("@langchain/openai", () => ({
      ChatOpenAI: vi.fn().mockImplementation(() => ({
        withStructuredOutput: () => ({
          invoke: vi.fn().mockRejectedValue({ status: 401, message: "Unauthorized" }),
        }),
      })),
    }));
    const r = await parseInstruction(
      "Send 5 HBAR to 0.0.8570146",
      "0.0.8570111",
      { maxRetries: 0, delay: async () => {} }
    );
    expect(r.llmStatus).toBe("fallback");
    vi.doUnmock("@langchain/openai");
  });
});

describe("LLM retry — succeeds on second attempt", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
  });

  it('returns llmStatus "ok" when LLM succeeds after one retry', async () => {
    let calls = 0;
    vi.doMock("@langchain/openai", () => ({
      ChatOpenAI: vi.fn().mockImplementation(() => ({
        withStructuredOutput: () => ({
          invoke: vi.fn().mockImplementation(async () => {
            calls++;
            if (calls === 1) throw { status: 500, message: "transient" };
            return {
              actionType: "HBAR_TRANSFER",
              recipientId: "0.0.8570146",
              amountHbar: 5,
              memo: "",
            };
          }),
        }),
      })),
    }));
    const r = await parseInstruction(
      "Send 5 HBAR to 0.0.8570146",
      "0.0.8570111",
      { maxRetries: 1, delay: async () => {} }
    );
    expect(r.llmStatus).toBe("ok");
    expect(r.parserMode).toBe("llm");
    vi.doUnmock("@langchain/openai");
  });
});
