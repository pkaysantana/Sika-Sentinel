/**
 * LLM retry / error-classification tests.
 *
 * classifyLlmError — maps error shapes to LlmErrorKind
 * withLlmRetry    — retry behaviour: count, retryable vs non-retryable,
 *                   delay injection, last-error propagation
 */

import { describe, it, expect, vi } from "vitest";
import {
  classifyLlmError,
  isRetryable,
  withLlmRetry,
  type LlmErrorKind,
} from "../src/agents/llmRetry";

// ── classifyLlmError ─────────────────────────────────────────────────────────

describe("classifyLlmError", () => {
  it("classifies 500 as server_error", () => {
    expect(classifyLlmError({ status: 500, message: "Internal Server Error" })).toBe("server_error");
  });

  it("classifies 502 as server_error", () => {
    expect(classifyLlmError({ status: 502 })).toBe("server_error");
  });

  it("classifies 503 as server_error", () => {
    expect(classifyLlmError({ status: 503 })).toBe("server_error");
  });

  it("classifies 429 as client_error (rate limit — retrying immediately won't help)", () => {
    expect(classifyLlmError({ status: 429 })).toBe("client_error");
  });

  it("classifies 401 as client_error", () => {
    expect(classifyLlmError({ status: 401 })).toBe("client_error");
  });

  it("classifies 400 as client_error", () => {
    expect(classifyLlmError({ status: 400 })).toBe("client_error");
  });

  it("classifies TypeError (fetch failed) as network_error", () => {
    expect(classifyLlmError(new TypeError("fetch failed"))).toBe("network_error");
  });

  it("classifies ECONNREFUSED code as network_error", () => {
    const err = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    expect(classifyLlmError(err)).toBe("network_error");
  });

  it("classifies ETIMEDOUT code as network_error", () => {
    const err = Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
    expect(classifyLlmError(err)).toBe("network_error");
  });

  it("classifies plain Error with no status as unknown", () => {
    expect(classifyLlmError(new Error("something unexpected"))).toBe("unknown");
  });

  it("classifies null as unknown", () => {
    expect(classifyLlmError(null)).toBe("unknown");
  });

  it("classifies string as unknown", () => {
    expect(classifyLlmError("some error string")).toBe("unknown");
  });

  it("reads status from err.response.status if err.status absent", () => {
    expect(classifyLlmError({ response: { status: 503 } })).toBe("server_error");
  });
});

// ── isRetryable ───────────────────────────────────────────────────────────────

describe("isRetryable", () => {
  const retryable: LlmErrorKind[] = ["server_error", "network_error"];
  const nonRetryable: LlmErrorKind[] = ["client_error", "unknown"];

  for (const kind of retryable) {
    it(`${kind} is retryable`, () => {
      expect(isRetryable(kind)).toBe(true);
    });
  }

  for (const kind of nonRetryable) {
    it(`${kind} is NOT retryable`, () => {
      expect(isRetryable(kind)).toBe(false);
    });
  }
});

// ── withLlmRetry ──────────────────────────────────────────────────────────────

const noDelay = async () => {};

describe("withLlmRetry — success path", () => {
  it("returns resolved value on first attempt", async () => {
    const fn = vi.fn().mockResolvedValue("result");
    const val = await withLlmRetry(fn, { delay: noDelay });
    expect(val).toBe("result");
    expect(fn).toHaveBeenCalledOnce();
  });
});

describe("withLlmRetry — 5xx retry", () => {
  it("retries up to maxRetries times on server_error", async () => {
    const serverErr = { status: 500, message: "Internal Server Error" };
    const fn = vi.fn()
      .mockRejectedValueOnce(serverErr)
      .mockRejectedValueOnce(serverErr)
      .mockResolvedValue("ok");

    const val = await withLlmRetry(fn, { maxRetries: 2, delay: noDelay });
    expect(val).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("throws after exhausting all retries", async () => {
    const serverErr = { status: 503, message: "Overloaded" };
    const fn = vi.fn().mockRejectedValue(serverErr);

    await expect(
      withLlmRetry(fn, { maxRetries: 2, delay: noDelay })
    ).rejects.toEqual(serverErr);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("calls delay between retries", async () => {
    const serverErr = { status: 500 };
    const fn = vi.fn()
      .mockRejectedValueOnce(serverErr)
      .mockResolvedValue("ok");
    const delay = vi.fn().mockResolvedValue(undefined);

    await withLlmRetry(fn, { maxRetries: 2, delay });
    expect(delay).toHaveBeenCalledOnce();
  });
});

describe("withLlmRetry — network error retry", () => {
  it("retries on TypeError (network failure)", async () => {
    const networkErr = new TypeError("fetch failed");
    const fn = vi.fn()
      .mockRejectedValueOnce(networkErr)
      .mockResolvedValue("recovered");

    const val = await withLlmRetry(fn, { maxRetries: 1, delay: noDelay });
    expect(val).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("withLlmRetry — non-retryable errors", () => {
  it("does NOT retry on 4xx (client_error)", async () => {
    const clientErr = { status: 400, message: "Bad Request" };
    const fn = vi.fn().mockRejectedValue(clientErr);

    await expect(
      withLlmRetry(fn, { maxRetries: 2, delay: noDelay })
    ).rejects.toEqual(clientErr);
    // Only one attempt — no retries
    expect(fn).toHaveBeenCalledOnce();
  });

  it("does NOT retry on unknown error", async () => {
    const unknownErr = new Error("Zod parse failure");
    const fn = vi.fn().mockRejectedValue(unknownErr);

    await expect(
      withLlmRetry(fn, { maxRetries: 2, delay: noDelay })
    ).rejects.toThrow("Zod parse failure");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("does NOT retry on 429 rate-limit", async () => {
    const rateLimitErr = { status: 429, message: "Too Many Requests" };
    const fn = vi.fn().mockRejectedValue(rateLimitErr);

    await expect(
      withLlmRetry(fn, { maxRetries: 2, delay: noDelay })
    ).rejects.toEqual(rateLimitErr);
    expect(fn).toHaveBeenCalledOnce();
  });
});

describe("withLlmRetry — last error propagated", () => {
  it("throws the last server error when all retries fail", async () => {
    const err1 = { status: 500, message: "attempt 1" };
    const err2 = { status: 503, message: "attempt 2" };
    const err3 = { status: 500, message: "attempt 3 — final" };
    const fn = vi.fn()
      .mockRejectedValueOnce(err1)
      .mockRejectedValueOnce(err2)
      .mockRejectedValueOnce(err3);

    await expect(
      withLlmRetry(fn, { maxRetries: 2, delay: noDelay })
    ).rejects.toEqual(err3);
  });
});
