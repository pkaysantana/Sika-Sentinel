import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  loadContext,
  reloadStore,
  getTreasuryPosture,
  setTreasuryPosture,
  addApprovedRecipient,
  getApprovedRecipients,
} from "../src/context/loader";

beforeEach(() => reloadStore());
afterEach(() => reloadStore());

describe("loadContext — known actors (in-memory fallback)", () => {
  it("loads operator 0.0.100", () => {
    const ctx = loadContext("0.0.100");
    expect(ctx.actorId).toBe("0.0.100");
    expect(ctx.actorRole).toBe("OPERATOR");
    expect(ctx.partnerId).toBe("partner-alpha");
    expect(ctx.amountThresholdHbar).toBe(100.0);
    expect(ctx.approvedRecipients).toContain("0.0.800");
    expect(ctx.enforceRecipientAllowlist).toBe(true);
  });

  it("loads partner 0.0.200", () => {
    const ctx = loadContext("0.0.200");
    expect(ctx.actorRole).toBe("PARTNER");
    expect(ctx.amountThresholdHbar).toBe(25.0);
    expect(ctx.enforceRecipientAllowlist).toBe(true);
  });

  it("recipientId param is optional and does not affect result", () => {
    const ctxWith = loadContext("0.0.100", "0.0.800");
    const ctxWithout = loadContext("0.0.100");
    expect(ctxWith).toEqual(ctxWithout);
  });

  it("throws for unknown actor", () => {
    expect(() => loadContext("0.0.999")).toThrow("0.0.999");
  });
});

describe("treasury posture", () => {
  it("default posture is NORMAL", () => {
    const ctx = loadContext("0.0.100");
    expect(ctx.treasuryPosture).toBe("NORMAL");
  });

  it("getTreasuryPosture returns NORMAL by default", () => {
    expect(getTreasuryPosture()).toBe("NORMAL");
  });

  it("setTreasuryPosture is reflected in loadContext", () => {
    setTreasuryPosture("FROZEN");
    expect(loadContext("0.0.100").treasuryPosture).toBe("FROZEN");
  });

  it("setTreasuryPosture is reflected in getTreasuryPosture", () => {
    setTreasuryPosture("RESTRICTED");
    expect(getTreasuryPosture()).toBe("RESTRICTED");
  });
});

describe("loadContext — JSON file backend", () => {
  let tmpDir: string;
  let origEnv: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sika-test-"));
    origEnv = process.env.CONTEXT_STORE_PATH;
  });

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.CONTEXT_STORE_PATH = origEnv;
    } else {
      delete process.env.CONTEXT_STORE_PATH;
    }
    reloadStore();
  });

  it("loads from JSON file", () => {
    const storeFile = path.join(tmpDir, "ctx.json");
    fs.writeFileSync(storeFile, JSON.stringify({
      treasury: { posture: "RESTRICTED" },
      actors: {
        "0.0.999": {
          role: "PARTNER",
          partner_id: "test-partner",
          amount_threshold_hbar: 10.0,
          approved_recipients: ["0.0.111"],
          enforce_recipient_allowlist: true,
        },
      },
    }));
    process.env.CONTEXT_STORE_PATH = storeFile;
    reloadStore();

    const ctx = loadContext("0.0.999");
    expect(ctx.actorRole).toBe("PARTNER");
    expect(ctx.partnerId).toBe("test-partner");
    expect(ctx.amountThresholdHbar).toBe(10.0);
    expect(ctx.treasuryPosture).toBe("RESTRICTED");
    expect(ctx.enforceRecipientAllowlist).toBe(true);
  });

  it("enforce flag false loaded from JSON", () => {
    const storeFile = path.join(tmpDir, "ctx.json");
    fs.writeFileSync(storeFile, JSON.stringify({
      treasury: { posture: "NORMAL" },
      actors: {
        "0.0.400": {
          role: "ADMIN",
          partner_id: "open-access",
          amount_threshold_hbar: 1000.0,
          approved_recipients: [],
          enforce_recipient_allowlist: false,
        },
      },
    }));
    process.env.CONTEXT_STORE_PATH = storeFile;
    reloadStore();

    const ctx = loadContext("0.0.400");
    expect(ctx.enforceRecipientAllowlist).toBe(false);
  });

  it("enforce flag defaults to true when omitted from JSON", () => {
    const storeFile = path.join(tmpDir, "ctx.json");
    fs.writeFileSync(storeFile, JSON.stringify({
      treasury: { posture: "NORMAL" },
      actors: {
        "0.0.500": {
          role: "OPERATOR",
          partner_id: "legacy",
          amount_threshold_hbar: 50.0,
          approved_recipients: ["0.0.800"],
          // enforce_recipient_allowlist omitted
        },
      },
    }));
    process.env.CONTEXT_STORE_PATH = storeFile;
    reloadStore();

    const ctx = loadContext("0.0.500");
    expect(ctx.enforceRecipientAllowlist).toBe(true);
  });

  it("falls back to in-memory when file is missing", () => {
    process.env.CONTEXT_STORE_PATH = "/nonexistent/path/ctx.json";
    reloadStore();
    const ctx = loadContext("0.0.100");
    expect(ctx.actorId).toBe("0.0.100");
  });

  it("falls back to in-memory when file has invalid JSON", () => {
    const storeFile = path.join(tmpDir, "ctx.json");
    fs.writeFileSync(storeFile, "not valid json");
    process.env.CONTEXT_STORE_PATH = storeFile;
    reloadStore();
    const ctx = loadContext("0.0.100");
    expect(ctx.actorId).toBe("0.0.100");
  });

  it("falls back to in-memory when actor record is missing a required field", () => {
    // Valid JSON, valid store shape, but actor record omits `role` — Zod should
    // reject the actor and the store parse should fail, triggering the fallback.
    const storeFile = path.join(tmpDir, "ctx.json");
    fs.writeFileSync(storeFile, JSON.stringify({
      treasury: { posture: "NORMAL" },
      actors: {
        "0.0.700": {
          // role is intentionally omitted
          partner_id: "missing-role-partner",
          amount_threshold_hbar: 10.0,
          approved_recipients: [],
          enforce_recipient_allowlist: true,
        },
      },
    }));
    process.env.CONTEXT_STORE_PATH = storeFile;
    reloadStore();
    // Fallback store should be used, which has the demo actors
    const ctx = loadContext("0.0.100");
    expect(ctx.actorId).toBe("0.0.100");
  });
});

// ── addApprovedRecipient edge cases ───────────────────────────────────────────

describe("addApprovedRecipient — deduplication", () => {
  it("adding a recipient that is already present is a no-op", async () => {
    // 0.0.800 is already in 0.0.100's approved list in the fallback store
    await addApprovedRecipient("0.0.100", "0.0.800");
    const recipients = getApprovedRecipients("0.0.100");
    expect(recipients.filter((r) => r === "0.0.800")).toHaveLength(1);
  });

  it("adding a new recipient appends it exactly once", async () => {
    await addApprovedRecipient("0.0.100", "0.0.9999");
    const recipients = getApprovedRecipients("0.0.100");
    expect(recipients).toContain("0.0.9999");
    expect(recipients.filter((r) => r === "0.0.9999")).toHaveLength(1);
  });

  it("adding the same new recipient twice still results in one entry", async () => {
    await addApprovedRecipient("0.0.100", "0.0.8888");
    await addApprovedRecipient("0.0.100", "0.0.8888");
    const recipients = getApprovedRecipients("0.0.100");
    expect(recipients.filter((r) => r === "0.0.8888")).toHaveLength(1);
  });

  it("throws for unknown actor", async () => {
    await expect(addApprovedRecipient("0.0.999", "0.0.800")).rejects.toThrow("0.0.999");
  });
});

describe("addApprovedRecipient — file write failure is non-fatal", () => {
  let tmpDir: string;
  let origEnv: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sika-write-fail-"));
    origEnv = process.env.CONTEXT_STORE_PATH;
  });

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.CONTEXT_STORE_PATH = origEnv;
    } else {
      delete process.env.CONTEXT_STORE_PATH;
    }
    reloadStore();
  });

  it("in-memory state is updated even when the store file does not exist", async () => {
    // Point to a path that cannot be written (nonexistent dir) so the
    // writeFile inside addApprovedRecipient will fail internally.
    process.env.CONTEXT_STORE_PATH = path.join(tmpDir, "nonexistent", "ctx.json");
    reloadStore();

    // Should not throw despite the file path being unwritable
    await expect(addApprovedRecipient("0.0.100", "0.0.7777")).resolves.toBeUndefined();

    // In-memory state must still reflect the addition
    const recipients = getApprovedRecipients("0.0.100");
    expect(recipients).toContain("0.0.7777");
  });
});
