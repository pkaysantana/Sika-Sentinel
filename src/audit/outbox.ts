/**
 * Audit Outbox — durable local queue for audit events.
 *
 * The outbox sits between `record()` and HCS. Every audit event is first
 * appended to a local, fsync'd journal; only after the entry is durable
 * does the writer attempt to ship it to HCS. If shipping fails, the entry
 * stays in `queued` state and a later `drain()` call (boot, cron, admin
 * action) retries it. If the journal write itself fails, `record()` raises
 * — the caller must treat the failure as loud because execution may have
 * already happened.
 *
 * Journal format
 * --------------
 *   Append-only JSONL. Each line is one full snapshot of an OutboxEntry:
 *     {"id":"...","state":"queued","createdAt":"...","updatedAt":"...",
 *      "attempts":0,"lastError":null,"topicId":"","sequenceNumber":-1,
 *      "message":{...AuditMessage...}}
 *   On load, all lines are replayed and folded by id — last writer wins.
 *   A single corrupt line does not invalidate prior entries; it is skipped
 *   with a console.warn. Compaction is not implemented in 1B; any future
 *   compaction can be a single `mv` of the current fold to a new file.
 *
 * Test backend
 * ------------
 *   A MemoryBackend is provided so tests never touch the disk. Pass it via
 *   `createOutbox({ backend: new MemoryBackend() })`. The default export
 *   (`outbox`) uses the file backend against AUDIT_OUTBOX_PATH or
 *   `data/audit-outbox.jsonl`.
 */

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { AuditMessage } from "../schemas/audit";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Lifecycle of an outbox entry.
 *
 *   queued          — durably written to the local journal; HCS submission
 *                     has either not been attempted yet or has failed
 *                     transiently. Attempts and lastError carry the history.
 *   written         — successfully submitted to HCS. topicId/sequenceNumber
 *                     populated from the receipt.
 *   failed_terminal — gave up after exhausting retry budget, or encountered
 *                     an unrecoverable error (e.g. malformed topic config).
 *                     No further shipping attempts will be made.
 */
export type OutboxState = "queued" | "written" | "failed_terminal";

export interface OutboxEntry {
  id: string;
  state: OutboxState;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  lastError: string | null;
  topicId: string;
  sequenceNumber: number;
  message: AuditMessage;
}

/**
 * Storage backend contract. `append` must be durable — a successful return
 * means the entry is guaranteed to survive a process crash. `loadAll`
 * returns every snapshot line in the order they were written; folding is
 * the caller's responsibility.
 */
export interface OutboxBackend {
  append(snapshot: OutboxEntry): void;
  loadAll(): OutboxEntry[];
}

// ── File backend (JSONL, fsync'd) ─────────────────────────────────────────────

export class FileOutboxBackend implements OutboxBackend {
  constructor(private readonly filePath: string) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  append(snapshot: OutboxEntry): void {
    const line = JSON.stringify(snapshot) + "\n";
    // Open → write → fsync → close. This is the minimum for a real
    // durability guarantee on POSIX and Windows. `fs.appendFileSync`
    // alone would leave the data in the OS page cache.
    const fd = fs.openSync(this.filePath, "a");
    try {
      fs.writeSync(fd, line);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }

  loadAll(): OutboxEntry[] {
    if (!fs.existsSync(this.filePath)) return [];
    const raw = fs.readFileSync(this.filePath, "utf-8");
    const entries: OutboxEntry[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line) as OutboxEntry);
      } catch (err) {
        console.warn(`Skipping corrupt outbox line: ${err}`);
      }
    }
    return entries;
  }
}

// ── Memory backend (tests) ────────────────────────────────────────────────────

export class MemoryOutboxBackend implements OutboxBackend {
  private readonly log: OutboxEntry[] = [];

  append(snapshot: OutboxEntry): void {
    // Deep clone so later in-place mutations on the returned entry do not
    // retroactively rewrite "history" in the log — mirrors the file backend
    // (which serializes to JSON and so gets the same effect for free).
    this.log.push(JSON.parse(JSON.stringify(snapshot)));
  }

  loadAll(): OutboxEntry[] {
    return this.log.map((e) => JSON.parse(JSON.stringify(e)));
  }
}

// ── Outbox store ──────────────────────────────────────────────────────────────

/**
 * Result of a ship attempt. Does not distinguish "not shipped yet" from
 * "shipped, now `written`" — inspect `entry.state`.
 */
export type ShipResult = {
  ok: true;
  entry: OutboxEntry;
} | {
  ok: false;
  entry: OutboxEntry;
  error: string;
};

/**
 * Callable that attempts to ship one audit event to HCS. In production this
 * is `submitMessage`; tests inject a stub. Must resolve with the message
 * augmented with topicId + sequenceNumber, or throw on failure.
 */
export type Shipper = (msg: AuditMessage) => Promise<AuditMessage>;

function now(): string {
  return new Date().toISOString();
}

export class Outbox {
  private readonly entries = new Map<string, OutboxEntry>();

  constructor(private readonly backend: OutboxBackend) {
    // Fold the journal on construction so in-memory state matches disk.
    for (const snap of backend.loadAll()) {
      this.entries.set(snap.id, snap);
    }
  }

  /**
   * Durably append a new audit event to the journal.
   *
   * Throws if the backend append fails — the caller must surface this as a
   * loud, pipeline-level error. A successful return means the event will
   * survive a crash, even if HCS shipping never happens.
   */
  enqueue(message: AuditMessage): OutboxEntry {
    const entry: OutboxEntry = {
      id: randomUUID(),
      state: "queued",
      createdAt: now(),
      updatedAt: now(),
      attempts: 0,
      lastError: null,
      topicId: "",
      sequenceNumber: -1,
      message,
    };
    this.backend.append(entry);
    this.entries.set(entry.id, entry);
    return { ...entry };
  }

  /**
   * Attempt to ship one queued entry via the supplied shipper. On success,
   * the entry transitions to `written`. On failure, the entry stays in
   * `queued` with `attempts` incremented and `lastError` set.
   *
   * Never throws — failures are returned as `{ ok: false }`. This keeps
   * the call site simple: the pipeline can call ship() and trust that
   * whatever it gets back, the durability invariant still holds.
   */
  async ship(entryId: string, shipper: Shipper): Promise<ShipResult> {
    const current = this.entries.get(entryId);
    if (!current) {
      return {
        ok: false,
        entry: {
          id: entryId,
          state: "failed_terminal",
          createdAt: now(),
          updatedAt: now(),
          attempts: 0,
          lastError: "entry not found",
          topicId: "",
          sequenceNumber: -1,
          message: {} as AuditMessage,
        },
        error: `Unknown outbox entry: ${entryId}`,
      };
    }
    if (current.state === "written") {
      return { ok: true, entry: { ...current } };
    }

    try {
      const shipped = await shipper(current.message);
      const updated: OutboxEntry = {
        ...current,
        state: "written",
        updatedAt: now(),
        attempts: current.attempts + 1,
        lastError: null,
        topicId: shipped.topicId,
        sequenceNumber: shipped.sequenceNumber,
        message: shipped,
      };
      this.backend.append(updated);
      this.entries.set(updated.id, updated);
      return { ok: true, entry: { ...updated } };
    } catch (err) {
      const updated: OutboxEntry = {
        ...current,
        updatedAt: now(),
        attempts: current.attempts + 1,
        lastError: err instanceof Error ? err.message : String(err),
      };
      this.backend.append(updated);
      this.entries.set(updated.id, updated);
      return {
        ok: false,
        entry: { ...updated },
        error: updated.lastError ?? "unknown shipper error",
      };
    }
  }

  /**
   * Iterate every currently queued entry and try to ship it. Used on boot
   * to flush anything left over from a prior crash, or as a cron target.
   * Returns counts for visibility.
   */
  async drain(shipper: Shipper): Promise<{ written: number; stillQueued: number }> {
    let written = 0;
    let stillQueued = 0;
    for (const entry of this.entries.values()) {
      if (entry.state !== "queued") continue;
      const result = await this.ship(entry.id, shipper);
      if (result.ok) written++;
      else stillQueued++;
    }
    return { written, stillQueued };
  }

  /**
   * Mark an entry as terminally failed. Used by admin/cron tooling when an
   * entry has clearly become unrecoverable (e.g. misconfigured topic, rule
   * schema change). The pipeline does not reach this path today.
   */
  markFailedTerminal(entryId: string, reason: string): OutboxEntry | null {
    const current = this.entries.get(entryId);
    if (!current) return null;
    const updated: OutboxEntry = {
      ...current,
      state: "failed_terminal",
      updatedAt: now(),
      lastError: reason,
    };
    this.backend.append(updated);
    this.entries.set(updated.id, updated);
    return { ...updated };
  }

  /** Current (folded) state of a specific entry. */
  get(entryId: string): OutboxEntry | null {
    const e = this.entries.get(entryId);
    return e ? { ...e } : null;
  }

  /** Snapshot of all entries. Ordered by insertion. */
  all(): OutboxEntry[] {
    return Array.from(this.entries.values()).map((e) => ({ ...e }));
  }

  /** Entries currently awaiting HCS confirmation. */
  pending(): OutboxEntry[] {
    return this.all().filter((e) => e.state === "queued");
  }
}

// ── Default instance ──────────────────────────────────────────────────────────

const DEFAULT_OUTBOX_PATH = path.resolve(
  process.cwd(),
  "data/audit-outbox.jsonl"
);

function resolveOutboxPath(): string {
  return process.env.AUDIT_OUTBOX_PATH ?? DEFAULT_OUTBOX_PATH;
}

let _defaultOutbox: Outbox | null = null;

/**
 * Get the process-wide default outbox instance. Constructed lazily on first
 * access so tests can override AUDIT_OUTBOX_PATH before the first call.
 */
export function getDefaultOutbox(): Outbox {
  if (_defaultOutbox) return _defaultOutbox;
  const backend = new FileOutboxBackend(resolveOutboxPath());
  _defaultOutbox = new Outbox(backend);
  return _defaultOutbox;
}

/** Reset the default outbox (tests only). */
export function resetDefaultOutbox(): void {
  _defaultOutbox = null;
}

/** Construct a fresh Outbox with a caller-supplied backend. Used by tests. */
export function createOutbox(backend: OutboxBackend): Outbox {
  return new Outbox(backend);
}
