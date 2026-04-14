/**
 * HCS tests — submitMessage + fetchMessages, both happy and failure paths.
 *
 * The @hashgraph/sdk is mocked to avoid live network calls.
 * global.fetch is mocked for Mirror Node HTTP calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AuditMessage } from "../src/schemas/audit";
import type { Action } from "../src/schemas/action";
import type { PolicyResult } from "../src/schemas/policy";

// ── Shared test fixtures ──────────────────────────────────────────────────────

const BASE_UUID = "00000000-0000-0000-0000-000000000001";

function makeAuditMessage(overrides: Partial<AuditMessage> = {}): AuditMessage {
  const correlationId = (overrides.correlationId as string | undefined) ?? BASE_UUID;
  const action: Action = {
    correlationId,
    actionType: "HBAR_TRANSFER",
    actorId: "0.0.100",
    recipientId: "0.0.800",
    amountHbar: 5.0,
    rawInstruction: "Send 5 HBAR to 0.0.800",
    memo: "",
  };
  const policyResult: PolicyResult = {
    decision: "APPROVED",
    denialReason: null,
    denialDetail: "",
    evaluatedRules: [],
    policyVersion: "",
  };
  return {
    correlationId,
    timestamp: "2026-01-01T00:00:00.000Z",
    action,
    policyResult,
    txId: "0.0.3@1234567890.000",
    scheduleId: "",
    topicId: "",
    sequenceNumber: -1,
    payloadHash: "",
    policyVersion: "",
    ...overrides,
    // action must match correlationId — rebuild if correlationId was overridden
    ...(overrides.correlationId ? { action: { ...action, correlationId: overrides.correlationId as string } } : {}),
  };
}

// ── Mock @hashgraph/sdk ───────────────────────────────────────────────────────

const mockExecute = vi.fn();
const mockGetReceipt = vi.fn();
const mockSetTopicId = vi.fn();
const mockSetMessage = vi.fn();

vi.mock("@hashgraph/sdk", () => {
  const TopicMessageSubmitTransaction = vi.fn().mockImplementation(() => ({
    setTopicId: mockSetTopicId.mockReturnThis(),
    setMessage: mockSetMessage.mockReturnThis(),
    execute: mockExecute,
  }));

  return {
    Client: {
      forTestnet: vi.fn().mockReturnValue({ setOperator: vi.fn(), setRequestTimeout: vi.fn() }),
      forMainnet: vi.fn().mockReturnValue({ setOperator: vi.fn(), setRequestTimeout: vi.fn() }),
    },
    AccountId: { fromString: vi.fn().mockReturnValue({}) },
    PrivateKey: {
      fromStringECDSA: vi.fn().mockReturnValue({}),
      fromStringDer: vi.fn().mockReturnValue({}),
    },
    TopicId: { fromString: vi.fn().mockReturnValue({}) },
    TopicMessageSubmitTransaction,
  };
});

// Mock the config module so we don't need real env vars
vi.mock("../src/hedera/config", () => ({
  hederaConfigFromEnv: vi.fn().mockReturnValue({
    operatorId: "0.0.100",
    operatorKey: "0xaabbccdd",
    network: "testnet",
    mirrorNodeUrl: "https://testnet.mirrornode.hedera.com",
  }),
}));

// Mock integrity module (pure hash — not what we're testing here)
vi.mock("../src/audit/integrity", () => ({
  computePayloadHash: vi.fn().mockReturnValue("mock-hash-abc"),
  verifyPayloadHash: vi.fn().mockReturnValue(true),
}));

// ── submitMessage ─────────────────────────────────────────────────────────────

describe("submitMessage — success", () => {
  beforeEach(() => {
    process.env.HCS_TOPIC_ID = "0.0.5001";
    mockGetReceipt.mockResolvedValue({ topicSequenceNumber: BigInt(7) });
    mockExecute.mockResolvedValue({ getReceipt: mockGetReceipt });
  });
  afterEach(() => {
    delete process.env.HCS_TOPIC_ID;
    vi.clearAllMocks();
  });

  it("returns topicId from env", async () => {
    const { submitMessage } = await import("../src/hedera/hcs");
    const result = await submitMessage(makeAuditMessage());
    expect(result.topicId).toBe("0.0.5001");
  });

  it("returns sequenceNumber from receipt", async () => {
    const { submitMessage } = await import("../src/hedera/hcs");
    const result = await submitMessage(makeAuditMessage());
    expect(result.sequenceNumber).toBe(7);
  });

  it("attaches payloadHash to the returned message", async () => {
    const { submitMessage } = await import("../src/hedera/hcs");
    const result = await submitMessage(makeAuditMessage());
    expect(result.payloadHash).toBe("mock-hash-abc");
  });

  it("calls TopicMessageSubmitTransaction.execute", async () => {
    const { submitMessage } = await import("../src/hedera/hcs");
    await submitMessage(makeAuditMessage());
    expect(mockExecute).toHaveBeenCalledOnce();
  });

  it("passes JSON-serialised message to setMessage", async () => {
    const { submitMessage } = await import("../src/hedera/hcs");
    await submitMessage(makeAuditMessage());
    const [payload] = mockSetMessage.mock.calls[0];
    const parsed = JSON.parse(payload as string);
    expect(parsed.correlationId).toBe(BASE_UUID);
    expect(parsed.payloadHash).toBe("mock-hash-abc");
  });
});

describe("submitMessage — HCS_TOPIC_ID missing", () => {
  beforeEach(() => {
    delete process.env.HCS_TOPIC_ID;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("throws when HCS_TOPIC_ID is not set", async () => {
    const { submitMessage } = await import("../src/hedera/hcs");
    await expect(submitMessage(makeAuditMessage())).rejects.toThrow("HCS_TOPIC_ID");
  });
});

describe("submitMessage — SDK execute failure", () => {
  beforeEach(() => {
    process.env.HCS_TOPIC_ID = "0.0.5001";
    mockExecute.mockRejectedValue(new Error("UNAVAILABLE: channel closed"));
  });
  afterEach(() => {
    delete process.env.HCS_TOPIC_ID;
    vi.clearAllMocks();
  });

  it("propagates SDK errors", async () => {
    const { submitMessage } = await import("../src/hedera/hcs");
    await expect(submitMessage(makeAuditMessage())).rejects.toThrow("UNAVAILABLE");
  });
});

// ── fetchMessages ─────────────────────────────────────────────────────────────

function makeMirrorResponse(items: Array<{ msg: AuditMessage; seqNo: number; topicId: string }>) {
  return {
    messages: items.map(({ msg, seqNo, topicId }) => ({
      consensus_timestamp: "1234567890.000",
      sequence_number: seqNo,
      topic_id: topicId,
      message: Buffer.from(JSON.stringify(msg)).toString("base64"),
    })),
  };
}

describe("fetchMessages — success", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("returns AuditMessages in sequence order", async () => {
    const msg1 = makeAuditMessage({ correlationId: "00000000-0000-0000-0000-000000000001", sequenceNumber: 1, topicId: "0.0.5001" });
    const msg2 = makeAuditMessage({ correlationId: "00000000-0000-0000-0000-000000000002", sequenceNumber: 2, topicId: "0.0.5001" });

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => makeMirrorResponse([
        { msg: msg1, seqNo: 1, topicId: "0.0.5001" },
        { msg: msg2, seqNo: 2, topicId: "0.0.5001" },
      ]),
    } as Response);

    const { fetchMessages } = await import("../src/hedera/hcs");
    const results = await fetchMessages("0.0.5001", 10);
    expect(results).toHaveLength(2);
    expect(results[0].correlationId).toBe("00000000-0000-0000-0000-000000000001");
    expect(results[1].correlationId).toBe("00000000-0000-0000-0000-000000000002");
  });

  it("populates sequenceNumber and topicId from Mirror Node envelope", async () => {
    const msg = makeAuditMessage({ correlationId: "00000000-0000-0000-0000-000000000099" });
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => makeMirrorResponse([{ msg, seqNo: 42, topicId: "0.0.5001" }]),
    } as Response);

    const { fetchMessages } = await import("../src/hedera/hcs");
    const [result] = await fetchMessages("0.0.5001", 1);
    expect(result.sequenceNumber).toBe(42);
    expect(result.topicId).toBe("0.0.5001");
  });

  it("returns empty array when messages list is empty", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [] }),
    } as Response);

    const { fetchMessages } = await import("../src/hedera/hcs");
    const results = await fetchMessages("0.0.5001");
    expect(results).toHaveLength(0);
  });

  it("skips malformed messages and parses the rest", async () => {
    const goodMsg = makeAuditMessage({ correlationId: "00000000-0000-0000-0000-000000000007" });
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        messages: [
          {
            consensus_timestamp: "1",
            sequence_number: 1,
            topic_id: "0.0.5001",
            message: Buffer.from("not json at all").toString("base64"),
          },
          {
            consensus_timestamp: "2",
            sequence_number: 2,
            topic_id: "0.0.5001",
            message: Buffer.from(JSON.stringify(goodMsg)).toString("base64"),
          },
        ],
      }),
    } as Response);

    const { fetchMessages } = await import("../src/hedera/hcs");
    const results = await fetchMessages("0.0.5001");
    expect(results).toHaveLength(1);
    expect(results[0].correlationId).toBe("00000000-0000-0000-0000-000000000007");
  });

  it("includes hashVerified=true when payloadHash is present and valid", async () => {
    const msg = makeAuditMessage({ payloadHash: "mock-hash-abc" });
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => makeMirrorResponse([{ msg, seqNo: 1, topicId: "0.0.5001" }]),
    } as Response);

    const { fetchMessages } = await import("../src/hedera/hcs");
    const [result] = await fetchMessages("0.0.5001") as Array<AuditMessage & { hashVerified?: boolean }>;
    expect(result.hashVerified).toBe(true);
  });
});

describe("fetchMessages — Mirror Node HTTP failure", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("throws when Mirror Node returns non-2xx", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    } as Response);

    const { fetchMessages } = await import("../src/hedera/hcs");
    await expect(fetchMessages("0.0.5001")).rejects.toThrow("Mirror Node request failed");
  });

  it("propagates network errors", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("ECONNREFUSED"));

    const { fetchMessages } = await import("../src/hedera/hcs");
    await expect(fetchMessages("0.0.5001")).rejects.toThrow("ECONNREFUSED");
  });
});
