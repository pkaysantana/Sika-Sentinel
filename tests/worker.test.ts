/**
 * Audit Drain Worker tests.
 *
 * All timer interactions use Vitest fake timers. The drain function is
 * injected via a mock shipper so no real HCS calls are made.
 *
 * Coverage:
 *   - start/stop/isRunning lifecycle
 *   - drain is called after pollIntervalMs elapses
 *   - onTick receives drain result
 *   - worker stops cleanly after stop()
 *   - worker does not double-start (idempotent start)
 *   - worker does not double-stop (idempotent stop)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDrainWorker } from "../src/audit/worker";
import { createOutbox, MemoryOutboxBackend, type Shipper } from "../src/audit/outbox";
import type { AuditMessage } from "../src/schemas/audit";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeMessage(): AuditMessage {
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
  };
}

function freshOutbox() {
  return createOutbox(new MemoryOutboxBackend());
}

function successShipper(): Shipper {
  return async (msg) => ({ ...msg, topicId: "0.0.5001", sequenceNumber: 1 });
}

function failingShipper(): Shipper {
  return async () => { throw new Error("HCS down"); };
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

describe("lifecycle — start / stop / isRunning", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("isRunning() is false before start()", () => {
    const worker = createDrainWorker(freshOutbox(), successShipper(), { pollIntervalMs: 100 });
    expect(worker.isRunning()).toBe(false);
  });

  it("isRunning() is true after start()", () => {
    const worker = createDrainWorker(freshOutbox(), successShipper(), { pollIntervalMs: 100 });
    worker.start();
    expect(worker.isRunning()).toBe(true);
    worker.stop();
  });

  it("isRunning() is false after stop()", () => {
    const worker = createDrainWorker(freshOutbox(), successShipper(), { pollIntervalMs: 100 });
    worker.start();
    worker.stop();
    expect(worker.isRunning()).toBe(false);
  });

  it("start() is idempotent — second call does nothing", () => {
    const outbox = freshOutbox();
    const drainSpy = vi.spyOn(outbox, "drain");
    const worker = createDrainWorker(outbox, successShipper(), { pollIntervalMs: 100 });
    worker.start();
    worker.start(); // second call — should not schedule an extra tick
    vi.advanceTimersByTime(150);
    // Drain should only have been called once (one tick, not two)
    expect(drainSpy).toHaveBeenCalledTimes(1);
    worker.stop();
  });

  it("stop() is idempotent — second call does not throw", () => {
    const worker = createDrainWorker(freshOutbox(), successShipper(), { pollIntervalMs: 100 });
    worker.start();
    worker.stop();
    expect(() => worker.stop()).not.toThrow();
  });
});

// ── Polling ───────────────────────────────────────────────────────────────────

describe("polling — drain called on schedule", () => {
  const INTERVAL = 100;

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("drain is NOT called immediately on start (deferred by pollIntervalMs)", () => {
    const outbox = freshOutbox();
    const drainSpy = vi.spyOn(outbox, "drain");
    const worker = createDrainWorker(outbox, successShipper(), { pollIntervalMs: INTERVAL });
    worker.start();
    // No time has elapsed
    expect(drainSpy).not.toHaveBeenCalled();
    worker.stop();
  });

  it("drain is called after pollIntervalMs elapses", async () => {
    const outbox = freshOutbox();
    const drainSpy = vi.spyOn(outbox, "drain").mockResolvedValue({ written: 0, stillQueued: 0, terminal: 0 });
    const worker = createDrainWorker(outbox, successShipper(), { pollIntervalMs: INTERVAL });
    worker.start();
    // Advance exactly one interval — fires the first tick, then stop to prevent re-scheduling
    await vi.advanceTimersByTimeAsync(INTERVAL);
    worker.stop();
    expect(drainSpy).toHaveBeenCalledTimes(1);
  });

  it("drain is called again after a second interval", async () => {
    const outbox = freshOutbox();
    const drainSpy = vi.spyOn(outbox, "drain").mockResolvedValue({ written: 0, stillQueued: 0, terminal: 0 });
    const worker = createDrainWorker(outbox, successShipper(), { pollIntervalMs: INTERVAL });
    worker.start();
    // Two intervals = two ticks
    await vi.advanceTimersByTimeAsync(INTERVAL * 2);
    worker.stop();
    expect(drainSpy).toHaveBeenCalledTimes(2);
  });

  it("drain is NOT called after stop()", async () => {
    const outbox = freshOutbox();
    const drainSpy = vi.spyOn(outbox, "drain").mockResolvedValue({ written: 0, stillQueued: 0, terminal: 0 });
    const worker = createDrainWorker(outbox, successShipper(), { pollIntervalMs: INTERVAL });
    worker.start();
    await vi.advanceTimersByTimeAsync(INTERVAL); // first tick fires
    worker.stop();
    await vi.advanceTimersByTimeAsync(INTERVAL * 2); // time passes, no more ticks
    expect(drainSpy).toHaveBeenCalledTimes(1);
  });
});

// ── onTick callback ───────────────────────────────────────────────────────────

describe("onTick callback", () => {
  const INTERVAL = 100;

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("onTick receives drain result on success", async () => {
    const outbox = freshOutbox();
    outbox.enqueue(makeMessage());
    const ticks: unknown[] = [];
    const worker = createDrainWorker(outbox, successShipper(), {
      pollIntervalMs: INTERVAL,
      onTick: (r) => ticks.push(r),
    });
    worker.start();
    await vi.advanceTimersByTimeAsync(INTERVAL);
    worker.stop();
    expect(ticks).toHaveLength(1);
    expect((ticks[0] as { written: number }).written).toBe(1);
  });

  it("onTick receives error field when drain throws", async () => {
    const outbox = freshOutbox();
    // Make drain itself throw (not just the shipper)
    vi.spyOn(outbox, "drain").mockRejectedValue(new Error("catastrophic drain failure"));
    const ticks: unknown[] = [];
    const worker = createDrainWorker(outbox, successShipper(), {
      pollIntervalMs: INTERVAL,
      onTick: (r) => ticks.push(r),
    });
    worker.start();
    await vi.advanceTimersByTimeAsync(INTERVAL);
    worker.stop();
    expect(ticks).toHaveLength(1);
    expect((ticks[0] as { error?: string }).error).toMatch(/catastrophic/);
  });

  it("onTick is optional — worker does not throw when omitted", async () => {
    const outbox = freshOutbox();
    vi.spyOn(outbox, "drain").mockResolvedValue({ written: 0, stillQueued: 0, terminal: 0 });
    const worker = createDrainWorker(outbox, successShipper(), { pollIntervalMs: INTERVAL });
    worker.start();
    await vi.advanceTimersByTimeAsync(INTERVAL);
    worker.stop();
    // If we got here without an unhandled rejection, the test passes
  });
});

// ── Integration: enqueue → drain via worker ───────────────────────────────────

describe("integration — entry enqueued before worker starts", () => {
  const INTERVAL = 100;

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("worker ships queued entry on first tick", async () => {
    const outbox = freshOutbox();
    const entry = outbox.enqueue(makeMessage());
    const worker = createDrainWorker(outbox, successShipper(), { pollIntervalMs: INTERVAL });
    worker.start();
    await vi.advanceTimersByTimeAsync(INTERVAL);
    worker.stop();
    expect(outbox.get(entry.id)?.state).toBe("written");
  });
});
