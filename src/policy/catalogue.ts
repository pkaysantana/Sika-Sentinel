/**
 * Policy Catalogue — declarative, versioned rule definitions.
 *
 * The catalogue is a data artifact: a JSON document describing which rules
 * exist, in what order they evaluate, what outcomes they produce, and what
 * reason codes they emit. The predicate implementations themselves live in
 * `src/policy/checkers.ts` and are referenced by name via the `check` field.
 *
 * A deterministic SHA-256 hash of the canonicalised catalogue JSON is
 * attached to every PolicyResult and AuditMessage as `policyVersion`, so
 * replayers can prove which rule set produced a given decision.
 */

import { z } from "zod";
import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { ActionTypeSchema } from "../schemas/action";
import { DecisionSchema, DenialReasonSchema } from "../schemas/policy";
import type { CheckerName } from "./checkers";
import { CHECKER_NAMES } from "./checkers";

// ── Schema ────────────────────────────────────────────────────────────────────

const CheckerNameSchema = z.enum(CHECKER_NAMES);

export const PolicyRuleDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  appliesTo: z.array(ActionTypeSchema).min(1),
  check: CheckerNameSchema,
  decision: DecisionSchema,
  denialReason: DenialReasonSchema.nullable().default(null),
  // Per-rule parameters, typed loosely here and validated by each checker.
  // Keeping this shape open lets us add rule parameters without schema churn.
  params: z.record(z.string(), z.unknown()).optional(),
});

export type PolicyRuleDefinition = z.infer<typeof PolicyRuleDefinitionSchema>;

export const PolicyCatalogueSchema = z.object({
  schemaVersion: z.literal("1.0"),
  name: z.string().min(1),
  description: z.string().default(""),
  rules: z.array(PolicyRuleDefinitionSchema).min(1),
});

export type PolicyCatalogue = z.infer<typeof PolicyCatalogueSchema>;

/**
 * A PolicyCatalogue after loading — carries the deterministic version hash
 * derived from its canonicalised JSON form.
 */
export interface LoadedPolicyCatalogue extends PolicyCatalogue {
  /** `sha256:<hex>` over the canonicalised catalogue JSON. */
  version: string;
}

// ── Canonical JSON + hashing ──────────────────────────────────────────────────

/**
 * Serialise a value with keys sorted recursively so the same logical object
 * always produces the same byte sequence. This is the basis for stable
 * version hashing — any semantic change to the catalogue changes the hash,
 * and no amount of cosmetic reordering does.
 */
export function canonicaliseJson(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value ?? null);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicaliseJson).join(",") + "]";
  }
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      (k) => JSON.stringify(k) + ":" + canonicaliseJson((value as Record<string, unknown>)[k])
    );
  return "{" + entries.join(",") + "}";
}

/**
 * Compute the version hash for a (parsed) catalogue. Returns `sha256:<hex>`.
 */
export function hashCatalogue(catalogue: PolicyCatalogue): string {
  const canonical = canonicaliseJson(catalogue);
  const digest = createHash("sha256").update(canonical, "utf-8").digest("hex");
  return `sha256:${digest}`;
}

// ── Loader ────────────────────────────────────────────────────────────────────

const DEFAULT_CATALOGUE_PATH = path.resolve(
  process.cwd(),
  "policies/default.json"
);

function resolveCataloguePath(): string {
  return process.env.POLICY_CATALOGUE_PATH ?? DEFAULT_CATALOGUE_PATH;
}

/**
 * Parse a raw catalogue object into a LoadedPolicyCatalogue.
 * Throws if the shape is invalid or if rule IDs are not unique.
 */
export function parseCatalogue(raw: unknown): LoadedPolicyCatalogue {
  const parsed = PolicyCatalogueSchema.parse(raw);

  const seenIds = new Set<string>();
  for (const rule of parsed.rules) {
    if (seenIds.has(rule.id)) {
      throw new Error(
        `Duplicate rule id in policy catalogue: '${rule.id}'. Rule ids must be unique.`
      );
    }
    seenIds.add(rule.id);
  }

  return { ...parsed, version: hashCatalogue(parsed) };
}

/**
 * Load the policy catalogue from disk. Resolution order:
 *   1. POLICY_CATALOGUE_PATH environment variable
 *   2. policies/default.json under the process working directory
 *
 * The result is memoised per-path for the life of the process; call
 * `reloadCatalogue()` in tests or after a hot-swap to force a re-read.
 */
const _cache = new Map<string, LoadedPolicyCatalogue>();

export function loadCatalogue(): LoadedPolicyCatalogue {
  const catPath = resolveCataloguePath();
  const cached = _cache.get(catPath);
  if (cached) return cached;

  if (!fs.existsSync(catPath)) {
    throw new Error(
      `Policy catalogue not found at ${catPath}. ` +
        `Set POLICY_CATALOGUE_PATH or place a catalogue at policies/default.json.`
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(catPath, "utf-8"));
  } catch (err) {
    throw new Error(
      `Failed to parse policy catalogue at ${catPath}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const loaded = parseCatalogue(raw);
  _cache.set(catPath, loaded);
  return loaded;
}

/** Clear the in-memory catalogue cache. Used by tests and hot reloads. */
export function reloadCatalogue(): void {
  _cache.clear();
}

/**
 * Select only the rules whose `appliesTo` includes the given action type.
 * Preserves the original declaration order so short-circuit semantics stay
 * identical to the pre-catalogue engine.
 */
export function rulesForActionType(
  catalogue: LoadedPolicyCatalogue,
  actionType: z.infer<typeof ActionTypeSchema>
): PolicyRuleDefinition[] {
  return catalogue.rules.filter((r) => r.appliesTo.includes(actionType));
}

// Re-export the CheckerName union so consumers can reference rule `check`
// values symbolically without importing from the checkers module directly.
export type { CheckerName };
