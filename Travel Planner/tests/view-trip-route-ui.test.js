import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const optimizedRouteSectionPath = path.resolve(
  process.cwd(),
  "src/view-trip/components/OptimizedRouteSection.jsx"
);
const tripViewPagePath = path.resolve(process.cwd(), "src/view-trip/index.jsx");
const unifiedTripMapPath = path.resolve(
  process.cwd(),
  "src/view-trip/components/UnifiedTripRouteMapSection.jsx"
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

test("trip page renders the unified trip route map instead of the old route section", () => {
  const source = fs.readFileSync(tripViewPagePath, "utf8");

  assert.equal(source.includes("UnifiedTripRouteMapSection"), true);
  assert.equal(source.includes("OptimizedRouteSection"), false);
  assert.equal(source.includes("CityItineraryMapSection"), false);
});

test("unified trip route map uses the Leaflet template structure and unified map endpoint", () => {
  const source = fs.readFileSync(unifiedTripMapPath, "utf8");

  assert.equal(source.includes("fetchTripMap"), true);
  assert.equal(source.includes("leaflet/dist/leaflet.css"), true);
  assert.equal(source.includes("CITYROUTE"), false);
  assert.equal(source.includes("Deterministic route graph"), true);
  assert.equal(source.includes("Tourist Spots"), true);
  assert.equal(source.includes("All Days"), true);
  assert.equal(source.includes("voy-unified-map__map-canvas"), true);
  assert.equal(source.includes("route label"), false);
});

test("create trip page remains the place where route preferences are chosen", () => {
  const source = fs.readFileSync(createTripPagePath, "utf8");

  assert.equal(source.includes("objective: \"best_experience\""), true);
  assert.equal(source.includes("alternativesCount: 3"), true);
});
