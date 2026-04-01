import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const optimizedRouteSectionPath = path.resolve(
  process.cwd(),
  "src/view-trip/components/OptimizedRouteSection.jsx"
);
const tripViewPagePath = path.resolve(process.cwd(), "src/view-trip/index.jsx");
const cityItineraryMapPath = path.resolve(
  process.cwd(),
  "src/view-trip/components/CityItineraryMapSection.jsx"
);
const mainRouterPath = path.resolve(process.cwd(), "src/main.jsx");
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

test("trip page renders the city itinerary map instead of the unified trip map", () => {
  const source = fs.readFileSync(tripViewPagePath, "utf8");

  assert.equal(source.includes("CityItineraryMapSection"), true);
  assert.equal(source.includes("UnifiedTripRouteMapSection"), false);
  assert.equal(source.includes("OptimizedRouteSection"), false);
  assert.equal(source.includes("clearTripMapCache"), false);
});

test("city itinerary map uses the static city-map endpoint and outline-based layout", () => {
  const source = fs.readFileSync(cityItineraryMapPath, "utf8");

  assert.equal(source.includes("fetchTripCityMap"), true);
  assert.equal(source.includes("buildCityMapDistanceMatrix"), true);
  assert.equal(source.includes("buildZoomedCityMapBounds"), true);
  assert.equal(source.includes("clipPath"), true);
  assert.equal(source.includes("Zoom in city map"), true);
  assert.equal(source.includes("Approximate pairwise distances"), true);
  assert.equal(source.includes("Supplemental transport context"), false);
  assert.equal(source.includes("Nearby arrival and local transit references"), false);
});

test("main router does not expose the unified trip map preview route", () => {
  const source = fs.readFileSync(mainRouterPath, "utf8");

  assert.equal(source.includes("dev/unified-trip-map-preview"), false);
  assert.equal(source.includes("UnifiedTripMapPreview"), false);
});

test("create trip page remains the place where route preferences are chosen", () => {
  const source = fs.readFileSync(createTripPagePath, "utf8");

  assert.equal(source.includes("objective: \"best_experience\""), true);
  assert.equal(source.includes("alternativesCount: 3"), true);
});
