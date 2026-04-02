import test from "node:test";
import assert from "node:assert/strict";
import {
  createChangeLogEntry,
  formatTimestamp,
  isTrackedFrontendPath,
  normalizeRelativePath,
} from "../scripts/frontendBackupSync.mjs";

test("normalizeRelativePath normalizes windows and dot-prefixed paths", () => {
  assert.equal(normalizeRelativePath(".\\src\\components\\Header.jsx"), "src/components/Header.jsx");
  assert.equal(normalizeRelativePath("./public//images///hero.jpg"), "public/images/hero.jpg");
});

test("isTrackedFrontendPath returns true for tracked frontend directories and files", () => {
  assert.equal(isTrackedFrontendPath("src/pages/Home.jsx"), true);
  assert.equal(isTrackedFrontendPath("public/world-map.svg"), true);
  assert.equal(isTrackedFrontendPath("shared/destinationAutocomplete.js"), true);
  assert.equal(isTrackedFrontendPath("shared/recommendations.js"), true);
  assert.equal(isTrackedFrontendPath("shared/trips.js"), true);
  assert.equal(isTrackedFrontendPath("index.html"), true);
});

test("isTrackedFrontendPath returns false for non-frontend project paths", () => {
  assert.equal(isTrackedFrontendPath("server/index.js"), false);
  assert.equal(isTrackedFrontendPath("tests/world-map.test.js"), false);
  assert.equal(isTrackedFrontendPath("node_modules/react/index.js"), false);
});

test("formatTimestamp keeps deterministic YYYY-MM-DD HH:MM format", () => {
  const timestamp = formatTimestamp(new Date(2026, 2, 31, 18, 4, 0, 0));
  assert.equal(timestamp, "2026-03-31 18:04");
});

test("createChangeLogEntry includes phase title, description, files and timestamp", () => {
  const entry = createChangeLogEntry({
    phaseTitle: "Phase Update - Auto Sync",
    description: "Mirrored frontend files.",
    files: ["src/main.jsx", "public/world-map.svg"],
    timestamp: "2026-03-31 22:10",
  });

  assert.match(entry, /## Phase Update - Auto Sync/);
  assert.match(entry, /Mirrored frontend files\./);
  assert.match(entry, /`src\/main\.jsx`/);
  assert.match(entry, /`public\/world-map\.svg`/);
  assert.match(entry, /Timestamp: 2026-03-31 22:10/);
});
