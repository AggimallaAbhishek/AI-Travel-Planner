import test from "node:test";
import assert from "node:assert/strict";
import { buildLoginPath, sanitizeNextPath } from "../src/lib/authRedirect.js";

test("sanitizeNextPath keeps internal app path", () => {
  assert.equal(sanitizeNextPath("/trips/abc123?view=full#day-1"), "/trips/abc123?view=full#day-1");
});

test("sanitizeNextPath blocks unsafe absolute URLs", () => {
  assert.equal(sanitizeNextPath("https://malicious.example"), "/");
  assert.equal(sanitizeNextPath("//malicious.example"), "/");
});

test("sanitizeNextPath blocks recursive login redirect", () => {
  assert.equal(sanitizeNextPath("/login"), "/");
  assert.equal(sanitizeNextPath("/login?next=%2Fmy-trips"), "/");
});

test("buildLoginPath appends encoded safe next parameter", () => {
  assert.equal(
    buildLoginPath("/my-trips?sort=recent#saved"),
    "/login?next=%2Fmy-trips%3Fsort%3Drecent%23saved"
  );
});

test("buildLoginPath omits next query for unsafe targets", () => {
  assert.equal(buildLoginPath("https://malicious.example"), "/login");
});
