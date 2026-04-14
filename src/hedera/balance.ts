/**
 * Hedera Execution Adapter — account balance query.
 *
 * Backend selection via TRANSFER_BACKEND env (same var as transfer):
 *   sdk      → @hashgraph/sdk AccountBalanceQuery (default)
 *   dry_run  → returns a deterministic stub balance
 */

import type { Action } from "../schemas/action";
import { hederaConfigFromEnv } from "./config";
import { withTimeout, DEFAULT_HEDERA_TIMEOUT_MS } from "./timeout";

export interface BalanceResult {
  readonly accountId: string;
  readonly balanceHbar: number;
  readonly network: string;
}

// ── SDK backend ───────────────────────────────────────────────────────────────

async function queryBalanceSdk(action: Action): Promise<BalanceResult> {
  const { Client, AccountBalanceQuery, AccountId } = await import("@hashgraph/sdk");
  const cfg = hederaConfigFromEnv();

  // AccountBalanceQuery is a free query — no operator signature required.
  // We still need a client pointed at the right network; forName handles that.
  const client = Client.forName(cfg.network);
  client.setRequestTimeout(DEFAULT_HEDERA_TIMEOUT_MS);

  try {
    const query = new AccountBalanceQuery().setAccountId(AccountId.fromString(action.actorId));
    const balance = await withTimeout(
      query.execute(client),
      DEFAULT_HEDERA_TIMEOUT_MS,
      "AccountBalanceQuery.execute",
    );

    return {
      accountId: action.actorId,
      balanceHbar: balance.hbars.toBigNumber().toNumber(),
      network: cfg.network,
    };
  } finally {
    client.close();
  }
}

// ── Dry-run backend ───────────────────────────────────────────────────────────

function queryBalanceDryRun(action: Action): BalanceResult {
  return {
    accountId: action.actorId,
    balanceHbar: 42.5, // deterministic stub
    network: "dry_run",
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function queryBalance(action: Action): Promise<BalanceResult> {
  const backend = (process.env.TRANSFER_BACKEND ?? "sdk").toLowerCase();
  if (backend === "dry_run") return queryBalanceDryRun(action);
  return queryBalanceSdk(action);
}
