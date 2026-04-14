/**
 * Hedera Execution Adapter — HBAR transfer.
 *
 * Called ONLY for APPROVED actions. Backend selection via TRANSFER_BACKEND env:
 *   sdk      → @hashgraph/sdk  (default, primary)
 *   cli      → Hiero CLI subprocess  (fallback)
 *   dry_run  → No-op stub  (tests / offline demo)
 */

import { spawn } from "child_process";
import type { Action } from "../schemas/action";
import { hederaConfigFromEnv, type HederaConfig } from "./config";
import { assertValidHederaId } from "./validation";
import { withTimeout, HederaTimeoutError, DEFAULT_HEDERA_TIMEOUT_MS } from "./timeout";

// ── Transfer result ───────────────────────────────────────────────────────────

export interface TransferResult {
  readonly txId: string;
  readonly senderId: string;
  readonly recipientId: string;
  readonly amountHbar: number;
  readonly network: string;
  readonly status: string;
}

// ── Typed exception ───────────────────────────────────────────────────────────

export class TransferError extends Error {
  readonly action: Action;
  readonly recoverable: boolean;

  constructor(message: string, action: Action, opts: { recoverable?: boolean } = {}) {
    super(message);
    this.name = "TransferError";
    this.action = action;
    this.recoverable = opts.recoverable ?? false;
  }
}

// ── Backend interface ─────────────────────────────────────────────────────────

export interface TransferBackend {
  transfer(action: Action, config: HederaConfig): Promise<TransferResult>;
}

// ── Backend: Hedera JS SDK (primary) ─────────────────────────────────────────

export class HederaSdkBackend implements TransferBackend {
  async transfer(action: Action, config: HederaConfig): Promise<TransferResult> {
    let sdk: typeof import("@hashgraph/sdk");
    try {
      sdk = await import("@hashgraph/sdk");
    } catch {
      throw new TransferError(
        "@hashgraph/sdk is not installed. Run: npm install @hashgraph/sdk",
        action,
        { recoverable: false }
      );
    }

    const { Client, AccountId, PrivateKey, TransferTransaction, Hbar } = sdk;

    let operatorId: InstanceType<typeof AccountId>;
    let operatorKey: InstanceType<typeof PrivateKey>;
    let treasuryId: InstanceType<typeof AccountId>;
    let treasuryKey: InstanceType<typeof PrivateKey>;
    let recipientId: InstanceType<typeof AccountId>;

    try {
      assertValidHederaId(config.operatorId, "operatorId");
      assertValidHederaId(config.treasuryId, "treasuryId");
      assertValidHederaId(action.recipientId, "recipientId");
      operatorId = AccountId.fromString(config.operatorId);
      operatorKey = PrivateKey.fromStringDer(config.operatorKey.replace(/^0x/i, ""));
      treasuryId = AccountId.fromString(config.treasuryId);
      treasuryKey = PrivateKey.fromStringDer(config.treasuryKey.replace(/^0x/i, ""));
      recipientId = AccountId.fromString(action.recipientId);
    } catch (err) {
      throw new TransferError(
        `Invalid account ID or key format: ${err}`,
        action,
        { recoverable: false }
      );
    }

    try {
      const client =
        config.network === "testnet" ? Client.forTestnet() : Client.forMainnet();
      client.setOperator(operatorId, operatorKey);
      client.setRequestTimeout(DEFAULT_HEDERA_TIMEOUT_MS);

      // 1 HBAR = 100_000_000 tinybars
      const tinybars = Math.round(action.amountHbar * 100_000_000);

      const txResponse = await withTimeout(
        new TransferTransaction()
          .addHbarTransfer(treasuryId, Hbar.fromTinybars(-tinybars))
          .addHbarTransfer(recipientId, Hbar.fromTinybars(tinybars))
          .freezeWith(client)
          .sign(treasuryKey)
          .then((tx) => tx.execute(client)),
        DEFAULT_HEDERA_TIMEOUT_MS,
        "TransferTransaction.execute",
      );

      const receipt = await withTimeout(
        txResponse.getReceipt(client),
        DEFAULT_HEDERA_TIMEOUT_MS,
        "TransferTransaction.getReceipt",
      );
      const status = receipt.status.toString();

      if (status !== "SUCCESS") {
        throw new TransferError(
          `Transfer rejected by network with status: ${status}`,
          action,
          { recoverable: false }
        );
      }

      const txId = txResponse.transactionId.toString();
      return {
        txId,
        senderId: config.treasuryId,
        recipientId: action.recipientId,
        amountHbar: action.amountHbar,
        network: config.network,
        status: "SUCCESS",
      };
    } catch (err) {
      if (err instanceof TransferError) throw err;
      if (err instanceof HederaTimeoutError) throw new TransferError(err.message, action, { recoverable: true });
      throw new TransferError(`SDK transfer failed: ${err}`, action, {
        recoverable: true,
      });
    }
  }
}

// ── Async spawn helper ────────────────────────────────────────────────────────

/**
 * Run a subprocess asynchronously and return its stdout as a string.
 * Rejects on non-zero exit code, ENOENT, or any spawn error.
 * Does NOT impose its own timeout — wrap the returned promise in withTimeout().
 */
function spawnAsync(binary: string, args: string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const proc = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    proc.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    proc.on("error", (err: NodeJS.ErrnoException) => reject(err));

    proc.on("close", (code: number | null) => {
      if (code === 0) {
        resolve(Buffer.concat(stdoutChunks).toString("utf-8"));
      } else {
        const stderr = Buffer.concat(stderrChunks).toString("utf-8").trim();
        reject(new Error(`Process exited with code ${code}${stderr ? `: ${stderr}` : ""}`));
      }
    });
  });
}

// ── Backend: Hiero CLI (fallback) ─────────────────────────────────────────────

const CLI_TIMEOUT_MS = DEFAULT_HEDERA_TIMEOUT_MS * 2; // CLI is slower than SDK

export class HieroCLIBackend implements TransferBackend {
  private readonly cliBinary = process.env.HIERO_CLI_PATH ?? "hiero";

  async transfer(action: Action, config: HederaConfig): Promise<TransferResult> {
    const args = [
      "transfer",
      "--network", config.network,
      "--operator-id", config.operatorId,
      "--operator-key", config.operatorKey,
      "--sender", config.treasuryId,
      "--sender-key", config.treasuryKey,
      "--recipient", action.recipientId,
      "--amount", String(action.amountHbar),
      "--unit", "hbar",
      "--output", "json",
    ];

    let stdout: string;
    try {
      stdout = await withTimeout(
        spawnAsync(this.cliBinary, args),
        CLI_TIMEOUT_MS,
        `hiero-cli transfer ${action.correlationId}`,
      );
    } catch (err: unknown) {
      if (err instanceof HederaTimeoutError) {
        throw new TransferError(err.message, action, { recoverable: false });
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("ENOENT") || msg.includes("not found")) {
        throw new TransferError(
          `Hiero CLI binary not found at '${this.cliBinary}'. Install it or set HIERO_CLI_PATH.`,
          action,
          { recoverable: false }
        );
      }
      throw new TransferError(`Hiero CLI failed: ${msg}`, action, {
        recoverable: false,
      });
    }

    let txId: string;
    try {
      const data = JSON.parse(stdout);
      txId = data.transactionId;
    } catch (err) {
      throw new TransferError(
        `Could not parse Hiero CLI output: ${err}\nRaw: ${stdout.slice(0, 200)}`,
        action,
        { recoverable: false }
      );
    }

    return {
      txId,
      senderId: config.treasuryId,
      recipientId: action.recipientId,
      amountHbar: action.amountHbar,
      network: config.network,
      status: "SUCCESS",
    };
  }
}

// ── Backend: dry-run (tests / offline demo) ───────────────────────────────────

export class DryRunBackend implements TransferBackend {
  async transfer(action: Action, config: HederaConfig): Promise<TransferResult> {
    const txId = `DRY-RUN-${action.correlationId}@0.000000000`;
    return {
      txId,
      senderId: config.treasuryId,
      recipientId: action.recipientId,
      amountHbar: action.amountHbar,
      network: config.network,
      status: "DRY_RUN",
    };
  }
}

// ── Backend registry and selection ────────────────────────────────────────────

const BACKENDS: Record<string, new () => TransferBackend> = {
  sdk: HederaSdkBackend,
  cli: HieroCLIBackend,
  dry_run: DryRunBackend,
};

function getBackend(): TransferBackend {
  const name = (process.env.TRANSFER_BACKEND ?? "sdk").toLowerCase();
  const Cls = BACKENDS[name];
  if (!Cls) {
    throw new Error(
      `Unknown TRANSFER_BACKEND '${name}'. Valid options: ${Object.keys(BACKENDS).join(", ")}`
    );
  }
  return new Cls();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Execute an approved HBAR transfer using the configured backend.
 */
export async function executeHbarTransfer(action: Action): Promise<TransferResult> {
  const backend = getBackend();
  const config = hederaConfigFromEnv();
  return backend.transfer(action, config);
}
