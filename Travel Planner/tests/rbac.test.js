import test from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_ROLE,
  USER_ROLE,
  buildAuthContextFromToken,
  normalizeEmail,
  parseAdminEmails,
  resolveAdminEmailAllowlist,
  resolveRoleCapabilities,
  resolveUserRoleByEmail,
} from "../server/lib/rbac.js";

test("normalizeEmail lowercases and trims values", () => {
  assert.equal(normalizeEmail("  AggiMallaAbhishek@GMAIL.COM "), "aggimallaabhishek@gmail.com");
  assert.equal(normalizeEmail(""), "");
  assert.equal(normalizeEmail(null), "");
});

test("resolveAdminEmailAllowlist always includes required fallback admin email", () => {
  const allowlist = resolveAdminEmailAllowlist("someone@example.com,another@example.com");
  assert.equal(allowlist.has("aggimallaabhishek@gmail.com"), true);
  assert.equal(allowlist.has("someone@example.com"), true);
});

test("parseAdminEmails skips empty values and normalizes case", () => {
  const parsed = parseAdminEmails(" Admin@Example.com, , second@example.com  ");
  assert.deepEqual(parsed, ["admin@example.com", "second@example.com"]);
});

test("resolveUserRoleByEmail matches admin role case-insensitively", () => {
  const role = resolveUserRoleByEmail(
    "AggimallaAbhishek@Gmail.Com",
    "someone@example.com"
  );
  assert.equal(role, ADMIN_ROLE);

  const nonAdminRole = resolveUserRoleByEmail(
    "traveler@example.com",
    "someone@example.com"
  );
  assert.equal(nonAdminRole, USER_ROLE);
});

test("buildAuthContextFromToken returns role, admin flag, and capabilities", () => {
  const adminContext = buildAuthContextFromToken(
    {
      uid: "uid-admin",
      email: "aggimallaabhishek@gmail.com",
      name: "Aggi",
    },
    { rawAdminEmails: "" }
  );
  assert.equal(adminContext.role, ADMIN_ROLE);
  assert.equal(adminContext.isAdmin, true);
  assert.equal(adminContext.capabilities.unrestrictedRateLimits, true);

  const userContext = buildAuthContextFromToken(
    {
      uid: "uid-user",
      email: "traveler@example.com",
      name: "Traveler",
    },
    { rawAdminEmails: "" }
  );
  assert.equal(userContext.role, USER_ROLE);
  assert.equal(userContext.isAdmin, false);
  assert.equal(userContext.capabilities.crossUserTripAccess, false);
});

test("resolveRoleCapabilities returns expected flags by role", () => {
  assert.deepEqual(resolveRoleCapabilities(ADMIN_ROLE), {
    unrestrictedRateLimits: true,
    crossUserTripAccess: true,
    debugTools: true,
  });
  assert.deepEqual(resolveRoleCapabilities(USER_ROLE), {
    unrestrictedRateLimits: false,
    crossUserTripAccess: false,
    debugTools: false,
  });
});
