import test from "node:test";
import assert from "node:assert/strict";
import { classifyAuthFailure } from "../server/middleware/auth.js";

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
