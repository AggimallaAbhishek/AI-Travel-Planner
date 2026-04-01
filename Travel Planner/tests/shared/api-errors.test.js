import test from "node:test";
import assert from "node:assert/strict";
import {
  createApiTimeoutError,
  resolveApiRequestFailure,
} from "../../shared/apiErrors.js";

test("resolveApiRequestFailure preserves AbortError for canceled requests", () => {
  const abortError = new Error("The user aborted a request.");
  abortError.name = "AbortError";

  const resolved = resolveApiRequestFailure(abortError);

  assert.equal(resolved.name, "AbortError");
  assert.equal(resolved.message, "Request was canceled.");
  assert.equal(resolved.status, 0);
});

test("resolveApiRequestFailure keeps timeout messaging for real timeout errors", () => {
  const timeoutError = createApiTimeoutError("The request timed out.");

  const resolved = resolveApiRequestFailure(timeoutError);

  assert.equal(resolved.name, "TimeoutError");
  assert.equal(resolved.message, "Request timed out. Please try again.");
  assert.equal(resolved.status, 0);
});
