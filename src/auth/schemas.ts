/**
 * Caller schemas — authenticated identity on the HTTP surface.
 *
 * Caller vs actor
 * ---------------
 *   - actor   — the Hedera account whose authority is being exercised
 *               (signs the transfer, owns the treasury, etc.).
 *   - caller  — the authenticated identity that *submitted the request*
 *               (a partner service, an internal console, a CLI). A caller
 *               may be permitted to act as one or more actors.
 *
 * Until 1B, actorId was trusted from the request body — anyone who knew
 * a Hedera account ID could claim it. From 1B onward, every request must
 * identify a caller, and the caller must explicitly be permitted to act
 * as the actor it names. The policy engine still runs against the actor's
 * role/posture; the caller identity is additional evidence attached to
 * the audit record so replayers can see who actually pushed the button.
 */

import { z } from "zod";

/** Kind of caller — kept open-ended so future SDKs/humans/agents fit. */
export const CallerKindSchema = z.enum(["dev", "service", "human"]);
export type CallerKind = z.infer<typeof CallerKindSchema>;

/**
 * On-disk caller record. Stored in the caller store (JSON file at
 * `data/callers.json` by default). Secrets are stored as SHA-256 hashes,
 * never as plaintext — on request, the incoming secret is hashed and
 * compared with a constant-time equality check.
 *
 * `permittedActors` controls which Hedera accounts this caller is allowed
 * to act as. Use `["*"]` for "any actor" (dev/admin escape hatch); use
 * an explicit list for partner services that can only act on their own
 * treasury.
 */
export const CallerRecordSchema = z.object({
  id: z.string().min(1),
  kind: CallerKindSchema,
  name: z.string().default(""),
  /** Hex-encoded SHA-256 of the caller's secret. Empty for dev callers. */
  secretHash: z.string().default(""),
  permittedActors: z.array(z.string()).default([]),
  createdAt: z.string().default(() => new Date().toISOString()),
});
export type CallerRecord = z.infer<typeof CallerRecordSchema>;

/**
 * Result of successfully resolving a caller on a request. This is the
 * shape that flows through the pipeline and into the audit record. Note
 * the secret hash is NOT included — we only carry enough identity to
 * authorise + attribute, never the credential material itself.
 */
export const ResolvedCallerSchema = z.object({
  id: z.string(),
  kind: CallerKindSchema,
  permittedActors: z.array(z.string()).default([]),
});
export type ResolvedCaller = z.infer<typeof ResolvedCallerSchema>;

/**
 * Compact caller reference embedded in every AuditMessage. We deliberately
 * do NOT embed `permittedActors` here — that's a live store property, not
 * historical truth, and we don't want replayers to confuse "what they
 * could do at the time" with "what they can do now".
 */
export const CallerReferenceSchema = z
  .object({
    id: z.string(),
    kind: CallerKindSchema,
  })
  .nullable()
  .default(null);
export type CallerReference = z.infer<typeof CallerReferenceSchema>;
