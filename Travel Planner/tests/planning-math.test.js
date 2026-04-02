import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWeightMatrixFromEdges,
  computePreferenceScore,
  hashPlanningInput,
  rankCandidatePlaces,
} from "../server/services/planningMath.js";
import {
  estimateDurationSeconds,
  haversineDistanceMeters,
} from "../server/services/geo.js";

test("computePreferenceScore favors higher-rated nearby attraction points", () => {
  const destination = {
    centerPoint: {
      latitude: 48.8566,
      longitude: 2.3522,
    },
  };
  const highQuality = computePreferenceScore(
    {
      category: "attraction",
      rating: 4.8,
      coordinates: {
        latitude: 48.857,
        longitude: 2.351,
      },
    },
    {
      travelStyle: "Cultural",
    },
    destination
  );
  const lowQuality = computePreferenceScore(
    {
      category: "attraction",
      rating: 3.1,
      coordinates: {
        latitude: 49.1,
        longitude: 2.8,
      },
    },
    {
      travelStyle: "Cultural",
    },
    destination
  );

  assert.equal(highQuality > lowQuality, true);
});

test("rankCandidatePlaces sorts by preference score and applies limit", () => {
  const ranked = rankCandidatePlaces(
    [
      { id: "a", category: "attraction", rating: 4.9, coordinates: {} },
      { id: "b", category: "restaurant", rating: 4.3, coordinates: {} },
      { id: "c", category: "hotel", rating: 5.0, coordinates: {} },
      { id: "d", category: "attraction", rating: 4.1, coordinates: {} },
    ],
    { travelStyle: "Adventure" },
    {},
    { limit: 2, preferredCategories: ["attraction", "restaurant"] }
  );

  assert.equal(ranked.length, 2);
  assert.equal(
    ranked.every((item) => ["attraction", "restaurant"].includes(item.category)),
    true
  );
  assert.equal(ranked[0].preferenceScore >= ranked[1].preferenceScore, true);
});

test("buildWeightMatrixFromEdges uses provided weights and fills missing weights", () => {
  const places = [
    { id: "p1", coordinates: { latitude: 12.9, longitude: 77.5 } },
    { id: "p2", coordinates: { latitude: 12.91, longitude: 77.52 } },
    { id: "p3", coordinates: { latitude: 12.92, longitude: 77.54 } },
  ];
  const matrix = buildWeightMatrixFromEdges(places, [
    {
      fromPlaceId: "p1",
      toPlaceId: "p2",
      weight: 750,
    },
  ]);

  assert.equal(matrix.length, 3);
  assert.equal(matrix[0][1], 750);
  assert.equal(Number.isFinite(matrix[1][2]), true);
  assert.equal(matrix[0][0], 0);

  const fallbackDistance = haversineDistanceMeters(
    places[1].coordinates,
    places[2].coordinates
  );
  const expectedFallbackDuration = estimateDurationSeconds(
    fallbackDistance,
    "drive"
  );
  assert.equal(matrix[1][2], expectedFallbackDuration);
});

test("hashPlanningInput is deterministic for identical payloads", () => {
  const first = hashPlanningInput({
    tripId: "trip-1",
    matrix: [
      [0, 2],
      [2, 0],
    ],
  });
  const second = hashPlanningInput({
    tripId: "trip-1",
    matrix: [
      [0, 2],
      [2, 0],
    ],
  });

  assert.equal(first, second);
});
