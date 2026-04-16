/**
 * Next.js Instrumentation Hook (Next.js 14+)
 *
 * This file runs once on server start in the Node.js runtime. We use it to
 * boot the audit drain worker so that any outbox entries left over from a
 * previous crash or a transient HCS failure are eventually shipped to Hedera.
 *
 * The worker is NOT started when:
 *   - DISABLE_AUDIT_WORKER=true  — useful in CI / test environments
 *   - Running on the edge runtime (worker only runs in Node.js)
 *
 * Next.js docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Skip in edge runtime — this module is Node.js only
  if (process.env.NEXT_RUNTIME === "edge") return;
  // Allow explicit opt-out (CI, integration tests, etc.)
  if (process.env.DISABLE_AUDIT_WORKER === "true") return;

  const { getDefaultOutbox } = await import("./src/audit/outbox");
  const { submitMessage } = await import("./src/hedera/hcs");
  const { createDrainWorker } = await import("./src/audit/worker");

  const worker = createDrainWorker(getDefaultOutbox(), submitMessage, {
    pollIntervalMs: Number(process.env.AUDIT_WORKER_INTERVAL_MS ?? 30_000),
    onTick(result) {
      if (result.error) {
        console.error(`[AuditWorker] tick error: ${result.error}`);
      }
    },
  });

  worker.start();
  console.log("[AuditWorker] Background drain worker started.");
}
