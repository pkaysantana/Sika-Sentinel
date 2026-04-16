import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Action } from "../src/schemas/action";
import {
  runPolicyOnly,
  run,
  isApproved,
  decisionLabel,
  type PipelineResult,
} from "../src/runtime/pipeline";
import { reloadStore, setTreasuryPosture } from "../src/context/loader";

// ── Mock Hedera execution modules ─────────────────────────────────────────────
vi.mock("../src/hedera/transfer", () => ({
  executeHbarTransfer: vi.fn().mockResolvedValue({ txId: "0.0.3@1234567890.000" }),
}));

vi.mock("../src/hedera/balance", () => ({
  queryBalance: vi.fn().mockResolvedValue({ balanceHbar: 42.5 }),
}));

vi.mock("../src/audit/trail", () => ({
  record: vi.fn().mockResolvedValue({
    message: {
      correlationId: "test-corr-id",
      timestamp: new Date().toISOString(),
      action: {},
      policyResult: {},
      txId: "0.0.3@1234567890.000",
      scheduleId: "",
      topicId: "0.0.5001",
      sequenceNumber: 7,
      payloadHash: "",
      policyVersion: "",
      caller: null,
    },
    state: "written",
    entryId: "mock-entry-id",
    topicId: "0.0.5001",
    sequenceNumber: 7,
  }),
}));

beforeEach(() => reloadStore());
afterEach(() => reloadStore());

function makeAction(overrides: Partial<Action> = {}): Action {
  return {
    correlationId: "test-corr-id",
    actionType: "HBAR_TRANSFER",
    actorId: "0.0.100",
    recipientId: "0.0.800",
    amountHbar: 5.0,
    rawInstruction: "Send 5 HBAR to 0.0.800",
    memo: "",
    ...overrides,
  };
}

// ── Return type ───────────────────────────────────────────────────────────────

describe("runPolicyOnly return type", () => {
  it("returns a PipelineResult object", () => {
    const result = runPolicyOnly(makeAction());
    expect(result).toBeDefined();
    expect(result.stage).toBeDefined();
    expect(result.action).toBeDefined();
  });

  it("carries the original action", () => {
    const action = makeAction();
    const result = runPolicyOnly(action);
    expect(result.action.correlationId).toBe(action.correlationId);
  });

  it("carries context", () => {
    const result = runPolicyOnly(makeAction());
    expect(result.context).not.toBeNull();
    expect(result.context?.actorId).toBe("0.0.100");
  });

  it("carries policyResult", () => {
    const result = runPolicyOnly(makeAction());
    expect(result.policyResult).not.toBeNull();
  });

  it("has a timestamp", () => {
    const result = runPolicyOnly(makeAction());
    expect(result.timestamp).toBeTruthy();
  });
});

// ── Happy path: APPROVED ──────────────────────────────────────────────────────

describe("happy path: APPROVED", () => {
  it("valid transfer is APPROVED", () => {
    const result = runPolicyOnly(makeAction());
    expect(result.policyResult?.decision).toBe("APPROVED");
    expect(result.stage).toBe("POLICY_EVALUATED");
  });

  it("isApproved() returns true", () => {
    const result = runPolicyOnly(makeAction());
    expect(isApproved(result)).toBe(true);
  });

  it("decisionLabel() returns APPROVED", () => {
    const result = runPolicyOnly(makeAction());
    expect(decisionLabel(result)).toBe("APPROVED");
  });
});

// ── Policy denials ────────────────────────────────────────────────────────────

describe("policy denials", () => {
  it("missing recipient is denied", () => {
    const result = runPolicyOnly(makeAction({ recipientId: "" }));
    expect(result.policyResult?.decision).toBe("DENIED");
    expect(result.policyResult?.denialReason).toBe("MISSING_RECIPIENT");
    expect(result.stage).toBe("POLICY_EVALUATED");
  });

  it("zero amount is denied", () => {
    const result = runPolicyOnly(makeAction({ amountHbar: 0 }));
    expect(result.policyResult?.decision).toBe("DENIED");
    expect(result.policyResult?.denialReason).toBe("INVALID_AMOUNT");
  });

  it("negative amount is denied", () => {
    const result = runPolicyOnly(makeAction({ amountHbar: -10 }));
    expect(result.policyResult?.decision).toBe("DENIED");
    expect(result.policyResult?.denialReason).toBe("INVALID_AMOUNT");
  });

  it("unapproved recipient is denied", () => {
    const result = runPolicyOnly(makeAction({ recipientId: "0.0.999" }));
    expect(result.policyResult?.decision).toBe("DENIED");
    expect(result.policyResult?.denialReason).toBe("RECIPIENT_NOT_APPROVED");
  });

  it("frozen treasury is denied", () => {
    setTreasuryPosture("FROZEN");
    const result = runPolicyOnly(makeAction());
    expect(result.policyResult?.decision).toBe("DENIED");
    expect(result.policyResult?.denialReason).toBe("TREASURY_FROZEN");
  });
});

// ── Non-approved, non-denied outcomes ────────────────────────────────────────

describe("non-approved outcomes", () => {
  it("amount above threshold requires approval", () => {
    const result = runPolicyOnly(makeAction({ amountHbar: 101 }));
    expect(result.policyResult?.decision).toBe("APPROVAL_REQUIRED");
    expect(isApproved(result)).toBe(false);
  });

  it("restricted treasury triggers manual review", () => {
    setTreasuryPosture("RESTRICTED");
    const result = runPolicyOnly(makeAction());
    expect(result.policyResult?.decision).toBe("MANUAL_REVIEW");
    expect(result.stage).toBe("POLICY_EVALUATED");
  });
});

// ── Denial properties ─────────────────────────────────────────────────────────

describe("denial result properties", () => {
  it("isApproved() is false on denial", () => {
    const result = runPolicyOnly(makeAction({ recipientId: "0.0.999" }));
    expect(isApproved(result)).toBe(false);
  });

  it("decisionLabel() is DENIED", () => {
    const result = runPolicyOnly(makeAction({ recipientId: "0.0.999" }));
    expect(decisionLabel(result)).toBe("DENIED");
  });

  it("has non-empty denial detail", () => {
    const result = runPolicyOnly(makeAction({ recipientId: "0.0.999" }));
    expect(result.policyResult?.denialDetail).not.toBe("");
  });
});

// ── Unknown actor (ERROR stage) ───────────────────────────────────────────────

describe("unknown actor", () => {
  it("returns ERROR stage", () => {
    const result = runPolicyOnly(makeAction({ actorId: "0.0.999" }));
    expect(result.stage).toBe("ERROR");
    expect(result.context).toBeNull();
    expect(result.policyResult).toBeNull();
  });

  it("error message contains actor ID", () => {
    const result = runPolicyOnly(makeAction({ actorId: "0.0.999" }));
    expect(result.error).toContain("0.0.999");
  });

  it("isApproved() is false for ERROR", () => {
    const result = runPolicyOnly(makeAction({ actorId: "0.0.999" }));
    expect(isApproved(result)).toBe(false);
  });

  it("decisionLabel() is ERROR", () => {
    const result = runPolicyOnly(makeAction({ actorId: "0.0.999" }));
    expect(decisionLabel(result)).toBe("ERROR");
  });
});

// ── Phase 2 placeholder fields ────────────────────────────────────────────────

describe("phase 2 placeholder fields", () => {
  it("txId, hcsTopicId, hcsSequenceNumber are empty in phase 1", () => {
    const result = runPolicyOnly(makeAction());
    expect(result.txId).toBe("");
    expect(result.hcsTopicId).toBe("");
    expect(result.hcsSequenceNumber).toBe(-1);
  });
});

// ── Correlation ID preserved ──────────────────────────────────────────────────

describe("correlation ID preservation", () => {
  it("is preserved end-to-end", () => {
    const action = makeAction();
    const result = runPolicyOnly(action);
    expect(result.action.correlationId).toBe(action.correlationId);
  });
});

// ── run() — full pipeline orchestration ──────────────────────────────────────

import { executeHbarTransfer } from "../src/hedera/transfer";
import { record as recordAudit } from "../src/audit/trail";

describe("run() — APPROVED path", () => {
  beforeEach(() => {
    vi.mocked(executeHbarTransfer).mockResolvedValue({ txId: "0.0.3@1234567890.000" });
    vi.mocked(recordAudit).mockResolvedValue({
      message: {
        correlationId: "test-corr-id",
        timestamp: new Date().toISOString(),
        action: {} as any,
        policyResult: {} as any,
        txId: "0.0.3@1234567890.000",
        scheduleId: "",
        topicId: "0.0.5001",
        sequenceNumber: 7,
        payloadHash: "",
        policyVersion: "",
        caller: null,
      },
      state: "written",
      entryId: "mock-entry-id",
      topicId: "0.0.5001",
      sequenceNumber: 7,
    });
    reloadStore();
  });
  afterEach(() => {
    vi.clearAllMocks();
    reloadStore();
  });

  it("returns stage AUDITED when transfer and audit succeed", async () => {
    const result = await run(makeAction());
    expect(result.stage).toBe("AUDITED");
  });

  it("populates txId from transfer result", async () => {
    const result = await run(makeAction());
    expect(result.txId).toBe("0.0.3@1234567890.000");
  });

  it("populates hcsTopicId and hcsSequenceNumber from audit", async () => {
    const result = await run(makeAction());
    expect(result.hcsTopicId).toBe("0.0.5001");
    expect(result.hcsSequenceNumber).toBe(7);
  });

  it("executeHbarTransfer is called once", async () => {
    await run(makeAction());
    expect(executeHbarTransfer).toHaveBeenCalledOnce();
  });

  it("recordAudit is called once regardless of outcome", async () => {
    await run(makeAction());
    expect(recordAudit).toHaveBeenCalledOnce();
  });
});

describe("run() — DENIED path", () => {
  beforeEach(() => {
    vi.mocked(executeHbarTransfer).mockClear();
    vi.mocked(recordAudit).mockResolvedValue({
      message: {
        correlationId: "test-corr-id",
        timestamp: new Date().toISOString(),
        action: {} as any,
        policyResult: {} as any,
        txId: "",
        scheduleId: "",
        topicId: "0.0.5001",
        sequenceNumber: 8,
        payloadHash: "",
        policyVersion: "",
        caller: null,
      },
      state: "written",
      entryId: "mock-entry-id",
      topicId: "0.0.5001",
      sequenceNumber: 8,
    });
    reloadStore();
  });
  afterEach(() => {
    vi.clearAllMocks();
    reloadStore();
  });

  it("returns stage AUDITED on denial (audit still written)", async () => {
    const result = await run(makeAction({ recipientId: "0.0.999" }));
    expect(result.stage).toBe("AUDITED");
  });

  it("does NOT call executeHbarTransfer when DENIED", async () => {
    await run(makeAction({ recipientId: "0.0.999" }));
    expect(executeHbarTransfer).not.toHaveBeenCalled();
  });

  it("txId is empty string on denial", async () => {
    const result = await run(makeAction({ recipientId: "0.0.999" }));
    expect(result.txId).toBe("");
  });

  it("recordAudit is still called once on denial", async () => {
    await run(makeAction({ recipientId: "0.0.999" }));
    expect(recordAudit).toHaveBeenCalledOnce();
  });
});

describe("run() — transfer failure", () => {
  beforeEach(() => {
    vi.mocked(executeHbarTransfer).mockRejectedValue(new Error("network timeout"));
    reloadStore();
  });
  afterEach(() => {
    vi.clearAllMocks();
    reloadStore();
  });

  it("returns stage ERROR when transfer throws", async () => {
    const result = await run(makeAction());
    expect(result.stage).toBe("ERROR");
  });

  it("error message contains transfer failure reason", async () => {
    const result = await run(makeAction());
    expect(result.error).toContain("Transfer failed");
  });
});

describe("run() — audit outbox failure is non-fatal (disk/permission error)", () => {
  // This path simulates a real outbox append failure (e.g. disk full).
  // HCS transient failures are handled inside record() and return state=queued,
  // not a thrown error. Only outbox.enqueue() failure propagates as a throw.
  beforeEach(() => {
    vi.mocked(executeHbarTransfer).mockResolvedValue({ txId: "0.0.3@1234567890.000" });
    vi.mocked(recordAudit).mockRejectedValue(new Error("ENOSPC: no space left on device"));
    reloadStore();
  });
  afterEach(() => {
    vi.clearAllMocks();
    reloadStore();
  });

  it("does not throw when audit record() throws", async () => {
    await expect(run(makeAction())).resolves.toBeDefined();
  });

  it("stage is EXECUTED (not AUDITED) when audit outbox fails after successful transfer", async () => {
    const result = await run(makeAction());
    expect(result.stage).toBe("EXECUTED");
  });

  it("txId is still populated even when audit fails", async () => {
    const result = await run(makeAction());
    expect(result.txId).toBe("0.0.3@1234567890.000");
  });

  it("auditStatus is failed_terminal when outbox throws", async () => {
    const result = await run(makeAction());
    expect(result.auditStatus).toBe("failed_terminal");
  });
});

describe("run() — audit queued (HCS down, outbox durable)", () => {
  // Simulates HCS submission failure: record() succeeds (entry durably queued)
  // but returns state="queued". Pipeline should treat this as normal — we have
  // durable evidence, just not yet on Hedera.
  beforeEach(() => {
    vi.mocked(executeHbarTransfer).mockResolvedValue({ txId: "0.0.3@1234567890.000" });
    vi.mocked(recordAudit).mockResolvedValue({
      message: {} as any,
      state: "queued",
      entryId: "mock-entry-id",
      topicId: "",
      sequenceNumber: -1,
    });
    reloadStore();
  });
  afterEach(() => {
    vi.clearAllMocks();
    reloadStore();
  });

  it("stage is AUDITED when audit is queued (durable)", async () => {
    const result = await run(makeAction());
    expect(result.stage).toBe("AUDITED");
  });

  it("auditStatus is queued", async () => {
    const result = await run(makeAction());
    expect(result.auditStatus).toBe("queued");
  });

  it("hcsTopicId and hcsSequenceNumber are empty when queued", async () => {
    const result = await run(makeAction());
    expect(result.hcsTopicId).toBe("");
    expect(result.hcsSequenceNumber).toBe(-1);
  });
});

describe("run() — unknown actor short-circuits in phase 1", () => {
  it("returns stage ERROR without calling transfer or audit", async () => {
    vi.mocked(executeHbarTransfer).mockClear();
    vi.mocked(recordAudit).mockClear();
    const result = await run(makeAction({ actorId: "0.0.999" }));
    expect(result.stage).toBe("ERROR");
    expect(executeHbarTransfer).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
