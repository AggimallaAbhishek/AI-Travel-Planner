import test from "node:test";
import assert from "node:assert/strict";
import { backfillTripMapEnrichment } from "../server/services/trips.js";

test("backfillTripMapEnrichment persists changed map enrichment for trip-detail reads", async () => {
  const persistedPayloads = [];
  const inputTrip = {
    id: "trip-1",
    itinerary: { days: [] },
    mapEnrichment: {
      status: "missing",
      geocodedStopCount: 0,
      unresolvedStopCount: 0,
      cityBounds: null,
    },
  };
  const enrichmentTrip = {
    ...inputTrip,
    itinerary: {
      days: [
        {
          dayNumber: 1,
          places: [
            {
              placeName: "Shibuya Crossing",
              geoCoordinates: { latitude: 35.6595, longitude: 139.7005 },
            },
          ],
        },
      ],
    },
    mapEnrichment: {
      status: "complete",
      geocodedStopCount: 1,
      unresolvedStopCount: 0,
      cityBounds: {
        north: 35.82,
        south: 35.55,
        east: 139.92,
        west: 139.55,
      },
    },
  };

  const result = await backfillTripMapEnrichment({
    trip: inputTrip,
    logContext: "trip detail",
    enrichFn: async () => ({
      trip: enrichmentTrip,
      changed: true,
      stats: {
        geocodedStopCount: 1,
        unresolvedStopCount: 0,
        status: "complete",
      },
    }),
    persistFn: async (payload) => {
      persistedPayloads.push(payload);
    },
  });

  assert.equal(result.trip.mapEnrichment.status, "complete");
  assert.equal(persistedPayloads.length, 1);
  assert.deepEqual(persistedPayloads[0], {
    tripId: "trip-1",
    itinerary: enrichmentTrip.itinerary,
    mapEnrichment: enrichmentTrip.mapEnrichment,
  });
});

test("backfillTripMapEnrichment skips persistence when enrichment does not change the trip", async () => {
  const persistedPayloads = [];
  const inputTrip = {
    id: "trip-2",
    itinerary: { days: [] },
    mapEnrichment: {
      status: "missing",
      geocodedStopCount: 0,
      unresolvedStopCount: 0,
      cityBounds: null,
    },
  };

  const result = await backfillTripMapEnrichment({
    trip: inputTrip,
    enrichFn: async () => ({
      trip: inputTrip,
      changed: false,
      stats: {
        geocodedStopCount: 0,
        unresolvedStopCount: 0,
        status: "missing",
      },
    }),
    persistFn: async (payload) => {
      persistedPayloads.push(payload);
    },
  });

  assert.equal(result.trip, inputTrip);
  assert.equal(persistedPayloads.length, 0);
});
