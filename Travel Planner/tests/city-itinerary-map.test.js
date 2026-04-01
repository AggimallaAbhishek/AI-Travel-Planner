import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCityMapDistanceMatrix,
  calculateGreatCircleDistanceMeters,
  CITY_ITINERARY_MAP_CANVAS,
  createCityMapMarkerLayout,
  deriveCityMapBoundsFromPlaces,
  formatCityMapDistance,
  projectCityMapPoint,
  resolveCityMapBounds,
} from "../src/lib/cityItineraryMap.js";

test("city itinerary map canvas uses a landscape aspect ratio", () => {
  assert.ok(CITY_ITINERARY_MAP_CANVAS.width > CITY_ITINERARY_MAP_CANVAS.height);
  assert.ok(CITY_ITINERARY_MAP_CANVAS.inset > 0);
});

test("resolveCityMapBounds prefers persisted city bounds when available", () => {
  const bounds = resolveCityMapBounds({
    cityBounds: {
      north: 35.82,
      south: 35.55,
      east: 139.92,
      west: 139.55,
    },
    places: [
      {
        geoCoordinates: { latitude: 35.67, longitude: 139.7 },
      },
    ],
  });

  assert.deepEqual(bounds, {
    north: 35.82,
    south: 35.55,
    east: 139.92,
    west: 139.55,
  });
});

test("deriveCityMapBounds creates a padded city viewport from resolved itinerary places", () => {
  const bounds = deriveCityMapBoundsFromPlaces([
    { geoCoordinates: { latitude: 35.6895, longitude: 139.6917 } },
    { geoCoordinates: { latitude: 35.6762, longitude: 139.6503 } },
  ]);

  assert.ok(bounds !== null);
  assert.ok(bounds.north > 35.6895);
  assert.ok(bounds.south < 35.6762);
  assert.ok(bounds.east > 139.6917);
  assert.ok(bounds.west < 139.6503);
});

test("projectCityMapPoint keeps resolved pins inside the local map inset area", () => {
  const point = projectCityMapPoint(
    { latitude: 35.6895, longitude: 139.6917 },
    {
      north: 35.82,
      south: 35.55,
      east: 139.92,
      west: 139.55,
    }
  );

  assert.ok(point.x >= CITY_ITINERARY_MAP_CANVAS.inset);
  assert.ok(
    point.x <= CITY_ITINERARY_MAP_CANVAS.width - CITY_ITINERARY_MAP_CANVAS.inset
  );
  assert.ok(point.y >= CITY_ITINERARY_MAP_CANVAS.inset);
  assert.ok(
    point.y <= CITY_ITINERARY_MAP_CANVAS.height - CITY_ITINERARY_MAP_CANVAS.inset
  );
});

test("createCityMapMarkerLayout deterministically spreads overlapping itinerary pins", () => {
  const laidOutMarkers = createCityMapMarkerLayout(
    [
      {
        id: "a",
        geoCoordinates: { latitude: 35.6895, longitude: 139.6917 },
      },
      {
        id: "b",
        geoCoordinates: { latitude: 35.6896, longitude: 139.6918 },
      },
      {
        id: "c",
        geoCoordinates: { latitude: 35.6894, longitude: 139.6916 },
      },
    ],
    {
      bounds: {
        north: 35.72,
        south: 35.66,
        east: 139.73,
        west: 139.65,
      },
      minDistance: 20,
      step: 8,
      maxRings: 3,
    }
  );

  assert.equal(laidOutMarkers.length, 3);
  assert.ok(laidOutMarkers.some((marker) => marker.isShifted));

  for (let first = 0; first < laidOutMarkers.length; first += 1) {
    for (let second = first + 1; second < laidOutMarkers.length; second += 1) {
      const firstMarker = laidOutMarkers[first];
      const secondMarker = laidOutMarkers[second];
      const distance = Math.hypot(
        firstMarker.markerPoint.x - secondMarker.markerPoint.x,
        firstMarker.markerPoint.y - secondMarker.markerPoint.y
      );

      assert.ok(distance >= 19.5);
    }
  }
});

test("calculateGreatCircleDistanceMeters returns approximate geographic distance", () => {
  const distanceMeters = calculateGreatCircleDistanceMeters(
    { latitude: 35.6895, longitude: 139.6917 },
    { latitude: 35.6762, longitude: 139.6503 }
  );

  assert.ok(distanceMeters > 3_000);
  assert.ok(distanceMeters < 5_500);
});

test("formatCityMapDistance formats meters and kilometers safely", () => {
  assert.equal(formatCityMapDistance(null), "—");
  assert.equal(formatCityMapDistance(320), "300 m");
  assert.equal(formatCityMapDistance(3_450), "3.5 km");
});

test("buildCityMapDistanceMatrix returns diagonal blanks and pairwise labels", () => {
  const places = [
    {
      id: "a",
      coordinates: { latitude: 35.6895, longitude: 139.6917 },
    },
    {
      id: "b",
      coordinates: { latitude: 35.6762, longitude: 139.6503 },
    },
  ];

  const matrix = buildCityMapDistanceMatrix(places);

  assert.equal(matrix.length, 2);
  assert.equal(matrix[0].length, 2);
  assert.equal(matrix[0][0].label, "—");
  assert.equal(matrix[1][1].label, "—");
  assert.ok(Number.isFinite(matrix[0][1].meters));
  assert.equal(matrix[0][1].label.endsWith("km"), true);
  assert.equal(matrix[0][1].label, matrix[1][0].label);
});
