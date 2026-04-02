import test from "node:test";
import assert from "node:assert/strict";
import { buildAuthSessionResponse } from "../server/routes/auth.js";

test("buildAuthSessionResponse returns normalized role and capabilities", () => {
  const session = buildAuthSessionResponse({
    authContext: {
      uid: "uid-admin",
      email: "aggimallaabhishek@gmail.com",
      displayName: "Abhishek",
      role: "admin",
      capabilities: {
        unrestrictedRateLimits: true,
        crossUserTripAccess: true,
        debugTools: true,
      },
    },
    user: {},
  });

  assert.deepEqual(session, {
    user: {
      uid: "uid-admin",
      email: "aggimallaabhishek@gmail.com",
      displayName: "Abhishek",
    },
    role: "admin",
    capabilities: {
      unrestrictedRateLimits: true,
      crossUserTripAccess: true,
      debugTools: true,
    },
  });
});

test("buildAuthSessionResponse falls back to user role defaults", () => {
  const session = buildAuthSessionResponse({
    user: {
      uid: "uid-user",
      email: "traveler@example.com",
      displayName: "Traveler",
      role: "user",
    },
  });

  assert.equal(session.user.uid, "uid-user");
  assert.equal(session.role, "user");
  assert.equal(session.capabilities.unrestrictedRateLimits, false);
  assert.equal(session.capabilities.crossUserTripAccess, false);
  assert.equal(session.capabilities.debugTools, false);
});
