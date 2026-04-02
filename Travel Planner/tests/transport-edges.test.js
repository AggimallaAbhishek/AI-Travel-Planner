import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGroundedTransportEdges,
} from "../server/services/transportEdges.js";

const PLACES = [
  {
    id: "a",
    coordinates: { latitude: 35.0, longitude: 135.75 },
  },
  {
    id: "b",
    coordinates: { latitude: 35.01, longitude: 135.77 },
  },
];

test("buildGroundedTransportEdges falls back to haversine when no API key is available", async () => {
  const originalApiKey = process.env.GOOGLE_MAPS_API_KEY;

  try {
    delete process.env.GOOGLE_MAPS_API_KEY;

    const result = await buildGroundedTransportEdges({
      destinationId: "dest-haversine",
      places: PLACES,
      existingEdges: [],
      forceRefresh: true,
    });

    assert.equal(result.usedFallbackEdges, true);
    assert.equal(result.fallbackEdges > 0, true);
    assert.equal(result.edges.some((edge) => edge.source === "haversine_fallback"), true);
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.GOOGLE_MAPS_API_KEY;
    } else {
      process.env.GOOGLE_MAPS_API_KEY = originalApiKey;
    }
  }
});

test("buildGroundedTransportEdges refreshes routes from Distance Matrix when configured", async () => {
  const originalApiKey = process.env.GOOGLE_MAPS_API_KEY;
  const originalFetch = global.fetch;

  try {
    process.env.GOOGLE_MAPS_API_KEY = "test-distance-key";
    global.fetch = async () =>
      new Response(
        JSON.stringify({
          status: "OK",
          rows: [
            {
              elements: [
                {
                  status: "OK",
                  distance: { value: 1600 },
                  duration: { value: 720 },
                },
              ],
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );

    const result = await buildGroundedTransportEdges({
      destinationId: "dest-live",
      places: PLACES,
      existingEdges: [],
      forceRefresh: true,
    });

    assert.equal(result.liveRefreshedEdges > 0, true);
    assert.equal(result.edges.some((edge) => edge.source === "distance_matrix"), true);
    assert.equal(
      result.edges.some((edge) => edge.weight === 720),
      true
    );
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.GOOGLE_MAPS_API_KEY;
    } else {
      process.env.GOOGLE_MAPS_API_KEY = originalApiKey;
    }
    global.fetch = originalFetch;
  }
});
