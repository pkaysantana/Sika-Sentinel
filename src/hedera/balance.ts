/**
 * Hedera Execution Adapter — account balance query.
 *
 * Backend selection via TRANSFER_BACKEND env (same var as transfer):
 *   sdk      → @hashgraph/sdk AccountBalanceQuery (default)
 *   dry_run  → returns a deterministic stub balance
 */

import type { Action } from "../schemas/action";
import { hederaConfigFromEnv } from "./config";

export interface BalanceResult {
  readonly accountId: string;
  readonly balanceHbar: number;
  readonly network: string;
}

// ── SDK backend ───────────────────────────────────────────────────────────────

async function queryBalanceSdk(action: Action): Promise<BalanceResult> {
  const { Client, AccountBalanceQuery, AccountId } = await import("@hashgraph/sdk");
  const cfg = hederaConfigFromEnv();
  const client = Client.forName(cfg.network);
  client.setOperator(cfg.operatorId, cfg.operatorKey);

  const query = new AccountBalanceQuery().setAccountId(AccountId.fromString(action.actorId));
  const balance = await query.execute(client);
  client.close();

  return {
    accountId: action.actorId,
    balanceHbar: balance.hbars.toBigNumber().toNumber(),
    network: cfg.network,
  };
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
