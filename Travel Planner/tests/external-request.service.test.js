import test from "node:test";
import assert from "node:assert/strict";
import {
  ExternalRequestError,
  classifyExternalRequestFailure,
  createTimeoutError,
  runExternalRequest,
} from "../server/services/externalRequest.js";

test("classifyExternalRequestFailure recognizes timeout and quota failures", () => {
  const timeout = classifyExternalRequestFailure(
    createTimeoutError("Request timed out.")
  );
  const quota = classifyExternalRequestFailure(
    new ExternalRequestError("Quota exceeded.", {
      kind: "quota",
      status: 429,
      retryable: false,
      provider: "google-places",
      operation: "lookup",
    })
  );

  assert.equal(timeout.kind, "timeout");
  assert.equal(timeout.retryable, true);
  assert.equal(quota.kind, "quota");
  assert.equal(quota.status, 429);
  assert.equal(quota.retryable, false);
});

test("runExternalRequest retries one retryable failure and then succeeds", async () => {
  let attempts = 0;

  const result = await runExternalRequest({
    provider: "google-places",
    operation: "lookup",
    retries: 1,
    logger: {
      warn() {},
      error() {},
    },
    execute: async () => {
      attempts += 1;

      if (attempts === 1) {
        throw new ExternalRequestError("Timed out.", {
          kind: "timeout",
          retryable: true,
          provider: "google-places",
          operation: "lookup",
        });
      }

      return { ok: true };
    },
  });

  assert.equal(attempts, 2);
  assert.deepEqual(result, { ok: true });
});
