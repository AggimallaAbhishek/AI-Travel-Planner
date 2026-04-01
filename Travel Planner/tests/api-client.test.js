import test from "node:test";
import assert from "node:assert/strict";
import { apiFetch } from "../src/lib/api.js";

test("apiFetch normalizes unexpected 426 platform responses", async () => {
  const originalFetch = global.fetch;

  global.fetch = async () => ({
    ok: false,
    status: 426,
    statusText: "Upgrade Required",
    headers: new Headers({
      "content-type": "text/plain",
    }),
    async text() {
      return "";
    },
  });

  try {
    await assert.rejects(
      () => apiFetch("/api/trips/generate"),
      (error) => {
        assert.equal(error?.status, 426);
        assert.equal(
          error?.message,
          "The travel service is temporarily unavailable. Please try again."
        );
        return true;
      }
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("apiFetch converts internal request timeouts into TimeoutError", async () => {
  const originalFetch = global.fetch;

  global.fetch = (_url, options = {}) =>
    new Promise((_resolve, reject) => {
      options.signal?.addEventListener(
        "abort",
        () => {
          reject(
            options.signal?.reason ??
              Object.assign(new Error("aborted"), { name: "AbortError" })
          );
        },
        { once: true }
      );
    });

  try {
    await assert.rejects(
      () => apiFetch("/api/trips/generate", { timeoutMs: 10 }),
      (error) => {
        assert.equal(error?.name, "TimeoutError");
        assert.equal(
          error?.message,
          "Request timed out. Please try again."
        );
        return true;
      }
    );
  } finally {
    global.fetch = originalFetch;
  }
});
