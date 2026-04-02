import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeTripPdfUiSnapshot,
  summarizeBrowserErrors,
} from "../src/lib/trip-pdf/verification.js";

test("analyzeTripPdfUiSnapshot detects auth-gated trip page", () => {
  const result = analyzeTripPdfUiSnapshot(`
    heading "Sign in to view this trip"
    button "Sign In With Google"
  `);

  assert.equal(result.hasAuthGate, true);
  assert.equal(result.hasRequiredButtons, false);
});

test("analyzeTripPdfUiSnapshot detects required PDF action buttons", () => {
  const result = analyzeTripPdfUiSnapshot(`
    button "Download PDF"
    button "Print"
  `);

  assert.equal(result.hasAuthGate, false);
  assert.equal(result.hasDownloadButton, true);
  assert.equal(result.hasPrintButton, true);
  assert.equal(result.hasRequiredButtons, true);
});

test("summarizeBrowserErrors flags browser error log entries", () => {
  const result = summarizeBrowserErrors("[info] boot complete\n[error] failed render");

  assert.equal(result.hasErrorEntries, true);
  assert.equal(result.normalized.includes("[error]"), true);
});
