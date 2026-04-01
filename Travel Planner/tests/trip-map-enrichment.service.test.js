import test from "node:test";
import assert from "node:assert/strict";
import { enrichTripWithPersistedGeocodes } from "../server/services/tripMapEnrichment.js";

test("trip map enrichment persists partial geocode results without failing unresolved stops", async () => {
  const requests = [];
  const serviceResult = await enrichTripWithPersistedGeocodes({
    apiKey: "places-key",
    fetchImpl: async (_url, options = {}) => {
      const query = JSON.parse(options.body).textQuery;
      requests.push(query);

      return {
        ok: true,
        headers: {
          get(name) {
            return name.toLowerCase() === "content-type"
              ? "application/json"
              : "";
          },
        },
        async json() {
          return {
            places: [],
          };
        },
      };
    },
    trip: {
      id: "trip-enrichment",
      userSelection: {
        location: { label: "Tokyo, Japan" },
      },
      itinerary: {
        days: [
          {
            dayNumber: 1,
            title: "Tokyo intro",
            places: [
              { placeName: "Shibuya Crossing" },
              { placeName: "Unknown Hidden Spot" },
            ],
          },
        ],
      },
      mapEnrichment: {
        status: "complete",
        geocodedStopCount: 0,
        unresolvedStopCount: 2,
        cityBounds: {
          north: 35.82,
          south: 35.55,
          east: 139.92,
          west: 139.55,
        },
      },
    },
  });

  assert.equal(serviceResult.changed, true);
  assert.equal(serviceResult.trip.itinerary.days[0].places[0].geocodeStatus, "resolved");
  assert.equal(
    serviceResult.trip.itinerary.days[0].places[0].geocodeSource,
    "world_poi_index"
  );
  assert.equal(
    serviceResult.trip.itinerary.days[0].places[0].location,
    "Tokyo, Japan"
  );
  assert.ok(
    serviceResult.trip.itinerary.days[0].places[0].mapsUrl.includes(
      "35.6595%2C139.7005"
    )
  );
  assert.equal(
    serviceResult.trip.itinerary.days[0].places[1].geocodeStatus,
    "unresolved"
  );
  assert.equal(serviceResult.stats.status, "partial");
  assert.equal(serviceResult.stats.geocodedStopCount, 1);
  assert.equal(serviceResult.stats.unresolvedStopCount, 1);
  assert.equal(serviceResult.stats.hasCityBounds, true);
  assert.equal(serviceResult.stats.worldPoiIndexHits, 1);
  assert.equal(serviceResult.stats.liveLookupCount, 1);
  assert.deepEqual(serviceResult.trip.mapEnrichment.cityBounds, {
    north: 35.82,
    south: 35.55,
    east: 139.92,
    west: 139.55,
  });
  assert.deepEqual(requests, ["Unknown Hidden Spot, Tokyo, Japan"]);
});
