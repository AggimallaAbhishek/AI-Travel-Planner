import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const optimizedRouteSectionPath = path.resolve(
  process.cwd(),
  "src/view-trip/components/OptimizedRouteSection.jsx"
);
const createTripPagePath = path.resolve(
  process.cwd(),
  "src/create-trip/index.jsx"
);

test("optimized route section no longer renders trip-page route editing controls", () => {
  const source = fs.readFileSync(optimizedRouteSectionPath, "utf8");

  assert.equal(source.includes("Route Profiles"), false);
  assert.equal(source.includes("Alternatives to compare"), false);
  assert.equal(source.includes("function ObjectiveToolbar"), false);
});

test("create trip page remains the place where route preferences are chosen", () => {
  const source = fs.readFileSync(createTripPagePath, "utf8");

  assert.equal(source.includes("objective: \"best_experience\""), true);
  assert.equal(source.includes("alternativesCount: 3"), true);
});
