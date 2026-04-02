import test from "node:test";
import assert from "node:assert/strict";
import { normalizePrivateKey } from "../server/lib/firebaseAdmin.js";

test("normalizePrivateKey trims whitespace and unwraps quoted key material", () => {
  const raw =
    "  \"-----BEGIN PRIVATE KEY-----\\nABC123\\n-----END PRIVATE KEY-----\\n\"  ";
  const normalized = normalizePrivateKey(raw);

  assert.match(normalized, /^-----BEGIN PRIVATE KEY-----\n/);
  assert.match(normalized, /\n-----END PRIVATE KEY-----\n$/);
  assert.equal(normalized.includes("\\n"), false);
  assert.equal(normalized.startsWith(" "), false);
});

test("normalizePrivateKey supports single-quoted values", () => {
  const raw =
    "'-----BEGIN PRIVATE KEY-----\\nABC123\\n-----END PRIVATE KEY-----\\n'";
  const normalized = normalizePrivateKey(raw);

  assert.match(normalized, /^-----BEGIN PRIVATE KEY-----\n/);
  assert.match(normalized, /\n-----END PRIVATE KEY-----\n$/);
});

test("normalizePrivateKey returns empty string for non-string values", () => {
  assert.equal(normalizePrivateKey(undefined), "");
  assert.equal(normalizePrivateKey(null), "");
});
