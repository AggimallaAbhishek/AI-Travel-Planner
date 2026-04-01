import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAuthenticatedUserFromFirebaseClaims,
  resolveFirebaseJwtConfig,
} from "../server/lib/auth/firebaseJwtVerifier.js";

test("resolveFirebaseJwtConfig prefers dedicated auth project id", () => {
  const config = resolveFirebaseJwtConfig({
    FIREBASE_AUTH_PROJECT_ID: "travel-planner-3098f",
    FIREBASE_PROJECT_ID: "ignored-project",
  });

  assert.equal(config.projectId, "travel-planner-3098f");
  assert.match(config.issuer, /travel-planner-3098f$/);
  assert.equal(config.audience, "travel-planner-3098f");
});

test("resolveFirebaseJwtConfig falls back to vite project id", () => {
  const config = resolveFirebaseJwtConfig({
    VITE_FIREBASE_PROJECT_ID: "travel-planner-3098f",
  });

  assert.equal(config.projectId, "travel-planner-3098f");
});

test("buildAuthenticatedUserFromFirebaseClaims maps Firebase JWT claims to app user shape", () => {
  const user = buildAuthenticatedUserFromFirebaseClaims({
    sub: "uid-123",
    email: "traveler@example.com",
    email_verified: true,
    firebase: {
      sign_in_provider: "google.com",
    },
  });

  assert.equal(user.uid, "uid-123");
  assert.equal(user.email, "traveler@example.com");
  assert.equal(user.emailVerified, true);
  assert.equal(user.provider, "google.com");
});
