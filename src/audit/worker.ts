/**
 * Audit Drain Worker — background loop that flushes queued outbox entries to HCS.
 *
 * The worker periodically calls `outbox.drain(shipper)` to ship any outbox
 * entries that are due (i.e. `nextAttemptAt` is null or in the past). It
 * uses a recursive `setTimeout` rather than `setInterval` so that a slow
 * drain does not queue up back-to-back ticks.
 *
 * Usage
 * -----
 *   const worker = createDrainWorker(getDefaultOutbox(), submitMessage);
 *   worker.start();       // begin background loop
 *   worker.stop();        // stop on graceful shutdown
 *
 * Next.js
 * -------
 *   Boot the worker from `instrumentation.ts` (Next.js 14+ instrumentation
 *   hook) so it runs on the Node.js server process. The worker is NOT started
 *   automatically on import — you must call `start()` explicitly.
 *
 * Test-friendliness
 * -----------------
 *   Inject a short `pollIntervalMs` and an immediate `Shipper` mock to test
 *   the worker without relying on real timers. The `drain()` result from each
 *   tick is emitted via the optional `onTick` callback so tests can observe it.
 */

import type { AuditMessage } from "../schemas/audit";
import type { Outbox, Shipper } from "./outbox";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DrainTickResult {
  written: number;
  stillQueued: number;
  terminal: number;
  error?: string;
}

export interface DrainWorkerOptions {
  /**
   * How often the worker polls for queued entries, in milliseconds.
   * Default: 30 000 (30 seconds).
   */
  pollIntervalMs?: number;
  /**
   * Optional callback invoked after each drain tick (success or error).
   * Useful for tests and observability.
   */
  onTick?: (result: DrainTickResult) => void;
}

export interface DrainWorker {
  /** Start the background polling loop. Idempotent if already running. */
  start(): void;
  /** Stop the loop. Idempotent if already stopped. */
  stop(): void;
  /** True if the worker is currently scheduled/running. */
  isRunning(): boolean;
}

// ── Factory ───────────────────────────────────────────────────────────────────

const DEFAULT_POLL_INTERVAL_MS = 30_000;

/**
 * Create a drain worker that periodically flushes the given outbox to HCS
 * using the supplied shipper function.
 *
 * The worker does NOT start automatically. Call `worker.start()` to begin
 * and `worker.stop()` to halt.
 */
export function createDrainWorker(
  outbox: Outbox,
  shipper: Shipper,
  options: DrainWorkerOptions = {}
): DrainWorker {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const onTick = options.onTick;

  let handle: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  async function tick(): Promise<void> {
    if (!running) return;

    let tickResult: DrainTickResult;
    try {
      const counts = await outbox.drain(shipper);
      tickResult = counts;
      if (counts.written > 0 || counts.terminal > 0) {
        console.log(
          `[AuditWorker] Drain: written=${counts.written} queued=${counts.stillQueued} terminal=${counts.terminal}`
        );
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[AuditWorker] Drain error: ${error}`);
      tickResult = { written: 0, stillQueued: 0, terminal: 0, error };
    }

    onTick?.(tickResult);

    if (running) {
      handle = setTimeout(() => {
        void tick();
      }, pollIntervalMs);
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      handle = setTimeout(() => {
        void tick();
      }, pollIntervalMs);
    },

    stop() {
      running = false;
      if (handle !== null) {
        clearTimeout(handle);
        handle = null;
      }
    },

    isRunning() {
      return running;
    },
  };
}
