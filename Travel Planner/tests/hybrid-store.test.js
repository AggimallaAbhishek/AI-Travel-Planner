import test from "node:test";
import assert from "node:assert/strict";
import {
  getHybridStoreMode,
  isStructuredDestinationFresh,
  listStructuredDestinationPlaces,
  listStructuredTransportEdges,
  markStructuredDestinationIngested,
  replaceStructuredDestinationPlaces,
  replaceStructuredTransportEdges,
  resetHybridStoreMemory,
  upsertStructuredDestination,
  upsertStructuredUser,
} from "../server/data/hybridStore.js";

test("hybrid store supports memory upsert/read flows", async () => {
  const previousSqlEnable = process.env.SQL_ENABLE;
  process.env.SQL_ENABLE = "false";
  resetHybridStoreMemory();

  try {
    const user = await upsertStructuredUser({
      firebaseUid: "uid-test-1",
      email: "tester@example.com",
    });
    assert.equal(user.firebaseUid, "uid-test-1");
    assert.equal(getHybridStoreMode(), "memory");

    const destination = await upsertStructuredDestination({
      canonicalName: "Tokyo, Japan",
      countryCode: "JP",
      centerPoint: {
        latitude: 35.6762,
        longitude: 139.6503,
      },
    });
    assert.equal(destination.canonicalName, "Tokyo, Japan");

    const freshUntil = new Date(Date.now() + 60_000).toISOString();
    const ingested = await markStructuredDestinationIngested({
      destinationId: destination.id,
      freshUntil,
    });
    assert.equal(isStructuredDestinationFresh(ingested), true);

    const places = await replaceStructuredDestinationPlaces({
      destinationId: destination.id,
      freshUntil,
      places: [
        {
          source: "mock",
          externalPlaceId: "mock-hotel-1",
          category: "hotel",
          name: "Tokyo Central Hotel",
          address: "Shinjuku",
          coordinates: {
            latitude: 35.6895,
            longitude: 139.6917,
          },
          rating: 4.5,
          priceLevel: "$$$",
          description: "Central hotel",
          metadata: {},
        },
        {
          source: "mock",
          externalPlaceId: "mock-attraction-1",
          category: "attraction",
          name: "Senso-ji",
          address: "Asakusa",
          coordinates: {
            latitude: 35.7148,
            longitude: 139.7967,
          },
          rating: 4.7,
          priceLevel: "",
          description: "Historic temple",
          metadata: {},
        },
      ],
    });
    assert.equal(places.length, 2);

    const listedPlaces = await listStructuredDestinationPlaces({
      destinationId: destination.id,
    });
    assert.equal(listedPlaces.length, 2);

    await replaceStructuredTransportEdges({
      destinationId: destination.id,
      mode: "drive",
      edges: [
        {
          fromPlaceId: listedPlaces[0].id,
          toPlaceId: listedPlaces[1].id,
          mode: "drive",
          distanceMeters: 1200,
          durationSeconds: 300,
          weight: 1200,
          source: "haversine",
        },
      ],
    });

    const edges = await listStructuredTransportEdges({
      destinationId: destination.id,
      mode: "drive",
    });
    assert.equal(edges.length, 1);
    assert.equal(edges[0].weight, 1200);
  } finally {
    if (previousSqlEnable === undefined) {
      delete process.env.SQL_ENABLE;
    } else {
      process.env.SQL_ENABLE = previousSqlEnable;
    }
    resetHybridStoreMemory();
  }
});

