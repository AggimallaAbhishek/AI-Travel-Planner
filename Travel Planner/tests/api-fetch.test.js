import test from "node:test";
import assert from "node:assert/strict";
import { apiFetch } from "../src/lib/api.js";

function createResponse({
  ok = true,
  status = 200,
  statusText = "OK",
  contentType = "application/json",
  body = "",
} = {}) {
  return {
    ok,
    status,
    statusText,
    headers: {
      get(name) {
        return String(name).toLowerCase() === "content-type" ? contentType : null;
      },
    },
    async text() {
      return body;
    },
  };
}

test("apiFetch keeps API-provided JSON error messages", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () =>
    createResponse({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      body: JSON.stringify({
        message: "Trip request is invalid.",
        errors: ["Destination is required."],
      }),
    });

  try {
    await assert.rejects(
      () => apiFetch("/api/trips/generate"),
      (error) => {
        assert.equal(error.message, "Trip request is invalid.");
        assert.equal(error.status, 400);
        assert.deepEqual(error.details?.errors, ["Destination is required."]);
        return true;
      }
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("apiFetch maps HTML gateway failures to a timeout message", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () =>
    createResponse({
      ok: false,
      status: 504,
      statusText: "Gateway Timeout",
      contentType: "text/html",
      body: "<html><body>Gateway Timeout</body></html>",
    });

  try {
    await assert.rejects(
      () => apiFetch("/api/trips/demo/map"),
      (error) => {
        assert.equal(error.message, "Request timed out. Please try again.");
        assert.equal(error.status, 504);
        return true;
      }
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("apiFetch preserves plain-text error bodies when upstream returns text", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () =>
    createResponse({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      contentType: "text/plain",
      body: "Routing provider temporarily unavailable.",
    });

  try {
    await assert.rejects(
      () => apiFetch("/api/trips/demo/routes"),
      (error) => {
        assert.equal(error.message, "Routing provider temporarily unavailable.");
        assert.equal(error.status, 503);
        assert.deepEqual(error.details, {
          rawText: "Routing provider temporarily unavailable.",
        });
        return true;
      }
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("apiFetch raises a TimeoutError when the client-side timeout elapses", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, options = {}) =>
    new Promise((_resolve, reject) => {
      options.signal?.addEventListener(
        "abort",
        () => {
          reject(options.signal.reason ?? Object.assign(new Error("aborted"), { name: "AbortError" }));
        },
        { once: true }
      );
    });

  try {
    await assert.rejects(
      () => apiFetch("/api/trips/generate", { timeoutMs: 20 }),
      (error) => {
        assert.equal(error.name, "TimeoutError");
        assert.equal(error.message, "Request timed out. Please try again.");
        assert.equal(error.status, 0);
        return true;
      }
    );
  } finally {
    global.fetch = originalFetch;
  }
});
