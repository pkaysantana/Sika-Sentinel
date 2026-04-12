import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";

const routePath = resolve(process.cwd(), "app/api/run/route.ts");
const DEMO_ACTOR_ID = process.env.SIKA_DEMO_ACTOR_ID;

const HAS_ROUTE = existsSync(routePath);
const HAS_DEMO_ACTOR = Boolean(DEMO_ACTOR_ID);

type PostHandler = (req: Request) => Promise<Response>;

function getField<T = unknown>(body: any, ...paths: string[]): T | undefined {
  for (const path of paths) {
    const value = path.split(".").reduce<any>((acc, key) => acc?.[key], body);
    if (value !== undefined) return value as T;
  }
  return undefined;
}

const runRouteTest = HAS_ROUTE && HAS_DEMO_ACTOR ? test : test.skip;

describe("POST /api/run integration", () => {
  test.skipIf(!HAS_ROUTE)("skipped: app/api/run/route.ts not present in this checkout", () => {});
  test.skipIf(!HAS_DEMO_ACTOR)("skipped: set SIKA_DEMO_ACTOR_ID to a real demo actor", () => {});

  runRouteTest(
    "preserves instruction and returns parse/policy/audit across approved, denied, and low-confidence flows",
    async () => {
      const routeModule = await import(pathToFileURL(routePath).href);
      const post = routeModule.POST as PostHandler;

      const cases = [
        {
          instruction: "Send 5 HBAR to 0.0.800",
          expectedDecision: "APPROVED",
          expectExecution: true,
        },
        {
          instruction: "Send 5 HBAR to 0.0.999",
          expectedDecision: "DENIED",
          expectExecution: false,
        },
        {
          instruction: "maybe send something to someone",
          expectedDecision: "DENIED",
          expectExecution: false,
        },
      ];

      for (const scenario of cases) {
        const req = new Request("http://localhost/api/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            instruction: scenario.instruction,
            actorId: DEMO_ACTOR_ID,
          }),
        });

        const res = await post(req);
        expect(res.ok).toBe(true);

        const body: any = await res.json();

        expect(
          getField(body, "audit.action.rawInstruction", "audit.action.raw_instruction")
        ).toBe(scenario.instruction);

        expect(getField(body, "parseResult", "parse_result")).toBeTruthy();

        expect(
          getField(body, "policyResult.decision", "policy_result.decision")
        ).toBe(scenario.expectedDecision);

        expect(
          Boolean(getField(body, "execution.executed", "executionExecuted", "executed"))
        ).toBe(scenario.expectExecution);

        expect(
          getField(body, "audit.parseResult", "audit.parse_result")
        ).toBeTruthy();

        expect(
          getField(body, "audit.policyResult", "audit.policy_result")
        ).toBeTruthy();
      }
    }
  );
});
