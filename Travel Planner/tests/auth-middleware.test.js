import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyAuthFailure,
  optionalAuth,
  requireAuth,
} from "../server/middleware/auth.js";

function createMockResponse() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
  };
}

test("classifyAuthFailure marks expired token as re-auth required", () => {
  const resolved = classifyAuthFailure({
    code: "auth/id-token-expired",
    message: "Firebase ID token has expired.",
  });

  assert.equal(resolved.status, 401);
  assert.equal(resolved.requiresReauth, true);
  assert.equal(resolved.code, "auth/id-token-expired");
});

test("classifyAuthFailure marks project/audience mismatch as configuration error", () => {
  const resolved = classifyAuthFailure({
    code: "auth/invalid-credential",
    message:
      "Firebase ID token has incorrect \"aud\" (audience) claim. Expected \"server-project\" but got \"client-project\".",
  });

  assert.equal(resolved.status, 500);
  assert.equal(resolved.requiresReauth, false);
  assert.equal(resolved.code, "auth/invalid-credential");
});

test("classifyAuthFailure marks invalid app credential as configuration error", () => {
  const resolved = classifyAuthFailure({
    code: "app/invalid-credential",
    message: "The credential implementation provided to initializeApp() is invalid.",
  });

  assert.equal(resolved.status, 500);
  assert.equal(resolved.requiresReauth, false);
  assert.equal(resolved.code, "app/invalid-credential");
});

test("optionalAuth allows guests when Authorization header is absent", async () => {
  const request = { headers: {} };
  const response = createMockResponse();
  let nextCalled = false;

  await optionalAuth(request, response, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(response.statusCode, 200);
});

test("optionalAuth rejects malformed Authorization header", async () => {
  const request = {
    headers: {
      authorization: "Token malformed-value",
    },
  };
  const response = createMockResponse();
  let nextCalled = false;

  await optionalAuth(request, response, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(response.statusCode, 401);
  assert.equal(
    response.payload.message,
    "Authorization header must use Bearer token format."
  );
  assert.equal(response.payload.code, "auth/invalid-authorization-header");
});

test("requireAuth rejects missing token with auth/missing-token", async () => {
  const request = { headers: {} };
  const response = createMockResponse();
  let nextCalled = false;

  await requireAuth(request, response, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(response.statusCode, 401);
  assert.equal(response.payload.code, "auth/missing-token");
  assert.equal(response.payload.message, "Authentication is required.");
});
