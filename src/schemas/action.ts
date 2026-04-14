/**
 * Action — the canonical internal representation of a payout instruction.
 *
 * Created by the intent parser from natural-language input and passed
 * unchanged through the context engine, policy engine, and audit layer.
 */

import { z } from "zod";
import { randomUUID } from "crypto";
import { isValidHederaId } from "../hedera/validation";

export const ActionTypeSchema = z.enum([
  "HBAR_TRANSFER",
  "CHECK_BALANCE",
]);
export type ActionType = z.infer<typeof ActionTypeSchema>;

export const ActionSchema = z.object({
  correlationId: z.string().uuid().default(() => randomUUID()),
  actionType: ActionTypeSchema,
  actorId: z.string().refine(isValidHederaId, (v) => ({
    message: `Invalid Hedera account ID for actorId: "${v}" — expected format <shard>.<realm>.<num>`,
  })),
  // Optional for non-transfer intents (e.g. CHECK_BALANCE); validated only when non-empty.
  recipientId: z.string().default("").refine(
    (v) => v === "" || isValidHederaId(v),
    (v) => ({ message: `Invalid Hedera account ID for recipientId: "${v}" — expected format <shard>.<realm>.<num>` }),
  ),
  amountHbar: z.number().default(0),
  rawInstruction: z.string(),
  memo: z.string().default(""),
});

export type Action = z.infer<typeof ActionSchema>;

/** Convenience factory that fills in correlationId automatically. */
export function makeAction(params: Omit<Action, "correlationId" | "memo"> & { correlationId?: string; memo?: string }): Action {
  return ActionSchema.parse(params);
}
