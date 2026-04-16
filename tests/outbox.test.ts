/**
 * Audit Outbox tests.
 *
 * All tests run against the MemoryOutboxBackend so no disk is touched.
 * We test:
 *   - enqueue: new entry is returned, state=queued, in pending()
 *   - ship: success → state=written, topicId/sequenceNumber populated
 *   - ship: shipper throws → state stays queued, lastError set, ok=false
 *   - ship: already-written entry returns ok=true without re-shipping
 *   - ship: unknown entryId returns ok=false
 *   - drain: ships all queued, returns counts
 *   - fold on load: replay of backend snapshots rebuilds in-memory state
 *   - markFailedTerminal: entry state transitions, not in pending()
 *   - all() / get() / pending() query methods
 */

import { describe, it, expect, vi } from "vitest";
import {
  Outbox,
  MemoryOutboxBackend,
  createOutbox,
  type Shipper,
} from "../src/audit/outbox";
import type { AuditMessage } from "../src/schemas/audit";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeMessage(overrides: Partial<AuditMessage> = {}): AuditMessage {
  return {
    correlationId: "test-corr",
    timestamp: new Date().toISOString(),
    action: {
      correlationId: "test-corr",
      actionType: "HBAR_TRANSFER",
      actorId: "0.0.100",
      recipientId: "0.0.800",
      amountHbar: 5,
      rawInstruction: "send 5 to 800",
      memo: "",
    },
    policyResult: {
      decision: "APPROVED",
      denialReason: null,
      denialDetail: "",
      evaluatedRules: [],
      policyVersion: "",
    },
    txId: "",
    scheduleId: "",
    topicId: "",
    sequenceNumber: -1,
    payloadHash: "",
    policyVersion: "",
    caller: null,
    ...overrides,
  };
}

function successShipper(topicId = "0.0.5001", seqNo = 7): Shipper {
  return async (msg) => ({ ...msg, topicId, sequenceNumber: seqNo });
}

function failingShipper(message = "HCS unavailable"): Shipper {
  return async () => { throw new Error(message); };
}

function freshOutbox(): Outbox {
  return createOutbox(new MemoryOutboxBackend());
}

// ── enqueue ───────────────────────────────────────────────────────────────────

describe("enqueue", () => {
  it("returns an entry with state=queued", () => {
    const box = freshOutbox();
    const entry = box.enqueue(makeMessage());
    expect(entry.state).toBe("queued");
  });

  it("assigns a uuid-shaped id", () => {
    const box = freshOutbox();
    const entry = box.enqueue(makeMessage());
    expect(entry.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("sets attempts=0 and lastError=null", () => {
    const box = freshOutbox();
    const entry = box.enqueue(makeMessage());
    expect(entry.attempts).toBe(0);
    expect(entry.lastError).toBeNull();
  });

  it("appears in pending()", () => {
    const box = freshOutbox();
    const entry = box.enqueue(makeMessage());
    expect(box.pending().some((e) => e.id === entry.id)).toBe(true);
  });

  it("appears in all()", () => {
    const box = freshOutbox();
    const entry = box.enqueue(makeMessage());
    expect(box.all().some((e) => e.id === entry.id)).toBe(true);
  });

  it("is retrievable by get()", () => {
    const box = freshOutbox();
    const entry = box.enqueue(makeMessage());
    expect(box.get(entry.id)?.id).toBe(entry.id);
  });

  it("stores the message in the entry", () => {
    const box = freshOutbox();
    const msg = makeMessage({ correlationId: "specific-id" });
    const entry = box.enqueue(msg);
    expect(entry.message.correlationId).toBe("specific-id");
  });
});

// ── ship: success ─────────────────────────────────────────────────────────────

describe("ship — success", () => {
  it("returns ok=true", async () => {
    const box = freshOutbox();
    const entry = box.enqueue(makeMessage());
    const result = await box.ship(entry.id, successShipper());
    expect(result.ok).toBe(true);
  });

  it("transitions state to written", async () => {
    const box = freshOutbox();
    const entry = box.enqueue(makeMessage());
    const result = await box.ship(entry.id, successShipper());
    expect(result.entry.state).toBe("written");
  });

  it("populates topicId and sequenceNumber from shipper", async () => {
    const box = freshOutbox();
    const entry = box.enqueue(makeMessage());
    const result = await box.ship(entry.id, successShipper("0.0.9999", 42));
    expect(result.ok && result.entry.topicId).toBe("0.0.9999");
    expect(result.ok && result.entry.sequenceNumber).toBe(42);
  });

  it("increments attempts", async () => {
    const box = freshOutbox();
    const entry = box.enqueue(makeMessage());
    const result = await box.ship(entry.id, successShipper());
    expect(result.entry.attempts).toBe(1);
  });

  it("clears lastError on success", async () => {
    const box = freshOutbox();
    const entry = box.enqueue(makeMessage());
    const result = await box.ship(entry.id, successShipper());
    expect(result.entry.lastError).toBeNull();
  });

  it("removes from pending() after success", async () => {
    const box = freshOutbox();
    const entry = box.enqueue(makeMessage());
    await box.ship(entry.id, successShipper());
    expect(box.pending().some((e) => e.id === entry.id)).toBe(false);
  });
});

// ── ship: shipper failure ────────────────────────────────────────────────────

describe("ship — shipper failure", () => {
  it("returns ok=false", async () => {
    const box = freshOutbox();
    const entry = box.enqueue(makeMessage());
    const result = await box.ship(entry.id, failingShipper());
    expect(result.ok).toBe(false);
  });

  it("never throws regardless of shipper error", async () => {
    const box = freshOutbox();
    const entry = box.enqueue(makeMessage());
    await expect(box.ship(entry.id, failingShipper())).resolves.toBeDefined();
  });

  it("entry stays in state=queued", async () => {
    const box = freshOutbox();
    const entry = box.enqueue(makeMessage());
    const result = await box.ship(entry.id, failingShipper());
    expect(result.entry.state).toBe("queued");
  });

  it("sets lastError to the thrown message", async () => {
    const box = freshOutbox();
    const entry = box.enqueue(makeMessage());
    const result = await box.ship(entry.id, failingShipper("network timeout"));
    expect(!result.ok && result.entry.lastError).toContain("network timeout");
  });

  it("increments attempts", async () => {
    const box = freshOutbox();
    const entry = box.enqueue(makeMessage());
    await box.ship(entry.id, failingShipper());
    const updated = box.get(entry.id)!;
    expect(updated.attempts).toBe(1);
  });

  it("entry stays in pending() after failure", async () => {
    const box = freshOutbox();
    const entry = box.enqueue(makeMessage());
    await box.ship(entry.id, failingShipper());
    expect(box.pending().some((e) => e.id === entry.id)).toBe(true);
  });

  it("returns error string in result", async () => {
    const box = freshOutbox();
    const entry = box.enqueue(makeMessage());
    const result = await box.ship(entry.id, failingShipper("oops"));
    expect(!result.ok && result.error).toContain("oops");
  });
});

// ── ship: idempotency ────────────────────────────────────────────────────────

describe("ship — already written", () => {
  it("returns ok=true without calling shipper again", async () => {
    const box = freshOutbox();
    const entry = box.enqueue(makeMessage());
    await box.ship(entry.id, successShipper());

    const stub = vi.fn().mockResolvedValue(makeMessage());
    const result = await box.ship(entry.id, stub);
    expect(result.ok).toBe(true);
    expect(stub).not.toHaveBeenCalled();
  });
});

// ── ship: unknown entry ──────────────────────────────────────────────────────

describe("ship — unknown entry", () => {
  it("returns ok=false with error description", async () => {
    const box = freshOutbox();
    const result = await box.ship("nonexistent-id", successShipper());
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("nonexistent-id");
  });
});

// ── drain ─────────────────────────────────────────────────────────────────────

describe("drain", () => {
  it("ships all queued entries", async () => {
    const box = freshOutbox();
    box.enqueue(makeMessage({ correlationId: "a" }));
    box.enqueue(makeMessage({ correlationId: "b" }));
    const counts = await box.drain(successShipper());
    expect(counts.written).toBe(2);
    expect(counts.stillQueued).toBe(0);
  });

  it("skips written entries", async () => {
    const box = freshOutbox();
    const e1 = box.enqueue(makeMessage({ correlationId: "a" }));
    await box.ship(e1.id, successShipper());
    box.enqueue(makeMessage({ correlationId: "b" }));

    const stub = vi.fn().mockImplementation(successShipper());
    const counts = await box.drain(stub);
    // Only the second (queued) entry should have been shipped
    expect(stub).toHaveBeenCalledOnce();
    expect(counts.written).toBe(1);
    expect(counts.stillQueued).toBe(0);
  });

  it("counts still-queued entries when shipper fails", async () => {
    const box = freshOutbox();
    box.enqueue(makeMessage({ correlationId: "a" }));
    box.enqueue(makeMessage({ correlationId: "b" }));
    const counts = await box.drain(failingShipper());
    expect(counts.written).toBe(0);
    expect(counts.stillQueued).toBe(2);
  });

  it("returns { written: 0, stillQueued: 0 } when outbox is empty", async () => {
    const box = freshOutbox();
    const counts = await box.drain(successShipper());
    expect(counts).toEqual({ written: 0, stillQueued: 0 });
  });
});

// ── markFailedTerminal ───────────────────────────────────────────────────────

describe("markFailedTerminal", () => {
  it("transitions entry to failed_terminal", () => {
    const box = freshOutbox();
    const entry = box.enqueue(makeMessage());
    box.markFailedTerminal(entry.id, "bad topic config");
    expect(box.get(entry.id)?.state).toBe("failed_terminal");
  });

  it("removes entry from pending()", () => {
    const box = freshOutbox();
    const entry = box.enqueue(makeMessage());
    box.markFailedTerminal(entry.id, "bad topic config");
    expect(box.pending().some((e) => e.id === entry.id)).toBe(false);
  });

  it("records reason in lastError", () => {
    const box = freshOutbox();
    const entry = box.enqueue(makeMessage());
    box.markFailedTerminal(entry.id, "bad topic config");
    expect(box.get(entry.id)?.lastError).toBe("bad topic config");
  });

  it("returns null for unknown entry", () => {
    const box = freshOutbox();
    expect(box.markFailedTerminal("no-such-id", "reason")).toBeNull();
  });
});

// ── fold on load ──────────────────────────────────────────────────────────────

describe("fold on load — MemoryOutboxBackend replay", () => {
  it("last snapshot wins when the same id appears twice", () => {
    const backend = new MemoryOutboxBackend();
    // Simulate two snapshots of the same entry (queued then written)
    const msg = makeMessage();
    const id = "fixed-id";
    const queued = {
      id,
      state: "queued" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attempts: 0,
      lastError: null,
      topicId: "",
      sequenceNumber: -1,
      message: msg,
    };
    const written = {
      ...queued,
      state: "written" as const,
      topicId: "0.0.5001",
      sequenceNumber: 7,
      attempts: 1,
    };
    backend.append(queued);
    backend.append(written);

    // Build a new Outbox — it replays the backend and should fold to written
    const box = createOutbox(backend);
    expect(box.get(id)?.state).toBe("written");
    expect(box.get(id)?.topicId).toBe("0.0.5001");
  });

  it("all queued entries on backend are present in pending() after construction", () => {
    const backend = new MemoryOutboxBackend();
    const a = {
      id: "a",
      state: "queued" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attempts: 0,
      lastError: null,
      topicId: "",
      sequenceNumber: -1,
      message: makeMessage({ correlationId: "a" }),
    };
    const b = { ...a, id: "b", message: makeMessage({ correlationId: "b" }) };
    backend.append(a);
    backend.append(b);

    const box = createOutbox(backend);
    expect(box.pending()).toHaveLength(2);
  });
});
