import test from "node:test";
import assert from "node:assert/strict";
import {
  createDestinationMarkerLayout,
  createWorldMapProjection,
  getDestinationMarkerPoint,
  normalizeMapDestination,
  normalizeMapDestinations,
  projectDestinationPoint,
  toEquirectangularPercent,
  WORLD_MAP_CANVAS,
  WORLD_MAP_PROJECTION,
} from "../src/lib/worldMap.js";

test("toEquirectangularPercent maps equator and prime meridian to center", () => {
  const point = toEquirectangularPercent(0, 0);

  assert.equal(point.x, 50);
  assert.equal(point.y, 50);
});

test("world map projection uses a geographic projection and positive scale", () => {
  assert.equal(WORLD_MAP_PROJECTION.name, "geoEquirectangular");
  assert.ok(WORLD_MAP_PROJECTION.config.paddingX > 0);
  assert.ok(WORLD_MAP_PROJECTION.config.paddingY > 0);
  assert.ok(WORLD_MAP_CANVAS.width > 0);
  assert.ok(WORLD_MAP_CANVAS.height > 0);
});

test("projectDestinationPoint projects known city coordinates into the canvas bounds", () => {
  const projection = createWorldMapProjection();
  const newYork = projectDestinationPoint(
    {
      longitude: -74.006,
      latitude: 40.7128,
    },
    projection
  );

  assert.ok(newYork.x > 0 && newYork.x < WORLD_MAP_CANVAS.width);
  assert.ok(newYork.y > 0 && newYork.y < WORLD_MAP_CANVAS.height);
});

test("normalizeMapDestination clamps invalid coordinates and removes manual point shifting", () => {
  const destination = normalizeMapDestination({
    name: "Example",
    longitude: 540,
    latitude: 120,
    markerOffsetX: 30,
    markerOffsetY: -20,
  });

  assert.equal(destination.longitude, 180);
  assert.equal(destination.latitude, 90);
  assert.equal(destination.markerOffsetX, 30);
  assert.equal(destination.markerOffsetY, -20);
  assert.equal("point" in destination, false);
});

test("normalizeMapDestinations preserves list length", () => {
  const input = [
    { id: "a", longitude: -10, latitude: 10 },
    { id: "b", longitude: 10, latitude: -10 },
  ];

  const normalized = normalizeMapDestinations(input);
  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].id, "a");
  assert.equal(normalized[1].id, "b");
});

test("normalizeMapDestination preserves destination data without deriving svg coordinates", () => {
  const destination = normalizeMapDestination({
    id: "offset-city",
    longitude: 10,
    latitude: 20,
    markerOffsetX: 12,
    markerOffsetY: -6,
  });

  assert.equal(destination.longitude, 10);
  assert.equal(destination.latitude, 20);
  assert.equal(destination.markerOffsetX, 12);
  assert.equal(destination.markerOffsetY, -6);
  assert.equal("projectedPoint" in destination, false);
});

test("normalizeMapDestinations optionally attaches projected points when a projection is supplied", () => {
  const projection = createWorldMapProjection();
  const [destination] = normalizeMapDestinations(
    [{ id: "tokyo", longitude: 139.6917, latitude: 35.6895 }],
    projection
  );

  assert.equal(destination.id, "tokyo");
  assert.ok(destination.point.x > 0 && destination.point.x < WORLD_MAP_CANVAS.width);
  assert.ok(destination.point.y > 0 && destination.point.y < WORLD_MAP_CANVAS.height);
});

test("getDestinationMarkerPoint defaults to geographic point for map accuracy", () => {
  const markerPoint = getDestinationMarkerPoint({
    point: { x: 300, y: 220 },
    markerOffsetX: 15,
    markerOffsetY: -10,
  });

  assert.equal(markerPoint.x, 300);
  assert.equal(markerPoint.y, 220);
});

test("getDestinationMarkerPoint can apply explicit offsets when requested", () => {
  const markerPoint = getDestinationMarkerPoint(
    {
      point: { x: 300, y: 220 },
      markerOffsetX: 15,
      markerOffsetY: -10,
    },
    { useMarkerOffsets: true }
  );

  assert.equal(markerPoint.x, 315);
  assert.equal(markerPoint.y, 210);
});

test("getDestinationMarkerPoint clamps markers to map bounds", () => {
  const markerPoint = getDestinationMarkerPoint(
    {
      point: { x: WORLD_MAP_CANVAS.width - 2, y: 3 },
      markerOffsetX: 40,
      markerOffsetY: -30,
    },
    { padding: 12 }
  );

  assert.equal(markerPoint.x, WORLD_MAP_CANVAS.width - 12);
  assert.equal(markerPoint.y, 12);
});

test("createDestinationMarkerLayout separates nearby markers with bounded shifts", () => {
  const laidOutMarkers = createDestinationMarkerLayout(
    [
      { id: "a", point: { x: 420, y: 260 } },
      { id: "b", point: { x: 422, y: 261 } },
      { id: "c", point: { x: 423, y: 259 } },
    ],
    {
      padding: 12,
      minDistance: 12,
      step: 6,
      maxRings: 2,
    }
  );

  assert.equal(laidOutMarkers.length, 3);
  assert.ok(laidOutMarkers.some((marker) => marker.isShifted));
  assert.ok(
    laidOutMarkers.every(
      (marker) => Math.hypot(marker.markerShift.x, marker.markerShift.y) <= 12.1
    )
  );

  for (let first = 0; first < laidOutMarkers.length; first += 1) {
    for (let second = first + 1; second < laidOutMarkers.length; second += 1) {
      const firstMarker = laidOutMarkers[first];
      const secondMarker = laidOutMarkers[second];
      const distance = Math.hypot(
        firstMarker.markerPoint.x - secondMarker.markerPoint.x,
        firstMarker.markerPoint.y - secondMarker.markerPoint.y
      );

      assert.ok(distance >= 11.5);
    }
  }
});
