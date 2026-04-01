import test from "node:test";
import assert from "node:assert/strict";
import {
  __resetTransportDatasetCacheForTests,
  buildTransportContextForCityMap,
  loadTransportDataset,
} from "../server/services/transportContext.js";

test.beforeEach(() => {
  __resetTransportDatasetCacheForTests();
});

test("loadTransportDataset parses the vendored repo transport JSON", () => {
  const dataset = loadTransportDataset();

  assert.equal(dataset.sourceVersion, "2026.04-transport-v1");
  assert.equal(dataset.destinationsByKey.has("dubai__ae"), true);
  assert.equal(dataset.destinationsByKey.has("tokyo__jp"), true);
  assert.ok(dataset.destinations.length >= 10);
});

test("buildTransportContextForCityMap returns deterministic nearby transport context for a supported destination", () => {
  const context = buildTransportContextForCityMap({
    destination: "Tokyo, Japan",
    cityBounds: {
      north: 35.82,
      south: 35.55,
      east: 139.92,
      west: 139.55,
    },
    markers: [
      {
        id: "shibuya",
        coordinates: { latitude: 35.6595, longitude: 139.7005 },
      },
      {
        id: "asakusa",
        coordinates: { latitude: 35.7148, longitude: 139.7967 },
      },
    ],
  });

  assert.ok(context);
  assert.equal(context.matchedDestinationKey, "tokyo__jp");
  assert.equal(context.sourceVersion, "2026.04-transport-v1");
  assert.ok(context.nearestAirports.length > 0);
  assert.ok(context.nearestStations.length > 0);
  assert.ok(context.recommendedArrivalHub);
  assert.equal(
    context.nearestStations[0].distanceMeters <=
      context.nearestStations.at(-1).distanceMeters,
    true
  );
});

test("buildTransportContextForCityMap degrades cleanly when no transport destination match exists", () => {
  const context = buildTransportContextForCityMap({
    destination: "Atlantis, Ocean",
  });

  assert.equal(context, null);
});
