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
  assert.equal(serviceResult.stats.liveLookupCount >= 1, true);
  assert.deepEqual(serviceResult.trip.mapEnrichment.cityBounds, {
    north: 35.82,
    south: 35.55,
    east: 139.92,
    west: 139.55,
  });
  assert.equal(requests.includes("Unknown Hidden Spot, Tokyo, Japan"), true);
});

test("trip map enrichment derives and resolves extra marker places from ai plan activities", async () => {
  const requests = [];
  const serviceResult = await enrichTripWithPersistedGeocodes({
    apiKey: "places-key",
    fetchImpl: async (_url, options = {}) => {
      const query = JSON.parse(options.body).textQuery;
      requests.push(query);

      if (query === "Tokyo, Japan") {
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
              places: [
                {
                  viewport: {
                    northEast: { latitude: 35.82, longitude: 139.92 },
                    southWest: { latitude: 35.55, longitude: 139.55 },
                  },
                },
              ],
            };
          },
        };
      }

      if (query.includes("Shinjuku Gyoen")) {
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
              places: [
                {
                  displayName: { text: "Shinjuku Gyoen National Garden" },
                  formattedAddress: "11 Naitocho, Shinjuku City, Tokyo",
                  location: { latitude: 35.6852, longitude: 139.7101 },
                  googleMapsUri:
                    "https://www.google.com/maps/search/?api=1&query=35.6852%2C139.7101",
                },
              ],
            };
          },
        };
      }

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
      id: "trip-inferred-markers",
      userSelection: {
        location: { label: "Tokyo, Japan" },
      },
      itinerary: {
        days: [
          {
            dayNumber: 1,
            title: "Arrival & Shinjuku Nightlife",
            places: [],
          },
        ],
      },
      aiPlan: {
        days: [
          {
            day: 1,
            title: "Arrival & Shinjuku Nightlife",
            activities: [
              "Explore Shinjuku Gyoen National Garden before the evening skyline views.",
            ],
            tips: "Use public transport and keep nearby landmarks grouped.",
          },
        ],
      },
    },
  });

  assert.equal(serviceResult.changed, true);
  assert.equal(serviceResult.stats.hasCityBounds, true);
  assert.equal(serviceResult.stats.inferredPlaceCount > 0, true);
  assert.equal(serviceResult.trip.mapEnrichment.markerDays.length, 1);
  assert.equal(serviceResult.trip.mapEnrichment.markerDays[0].places.length > 0, true);
  assert.equal(
    serviceResult.trip.mapEnrichment.markerDays[0].places.some(
      (place) =>
        place.placeName === "Shinjuku Gyoen National Garden" &&
        place.geocodeStatus === "resolved"
    ),
    true
  );
  assert.equal(
    requests.includes("Shinjuku Gyoen National Garden, Tokyo, Japan"),
    true
  );
});

test("trip map enrichment retries identical unresolved lookups after an empty geocode result", async () => {
  let retrySpotRequests = 0;

  const serviceResult = await enrichTripWithPersistedGeocodes({
    apiKey: "places-key",
    concurrency: 1,
    fetchImpl: async (_url, options = {}) => {
      const query = JSON.parse(options.body).textQuery;

      if (query === "Kyoto, Japan") {
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
              places: [
                {
                  viewport: {
                    northEast: { latitude: 35.12, longitude: 135.9 },
                    southWest: { latitude: 34.92, longitude: 135.64 },
                  },
                },
              ],
            };
          },
        };
      }

      if (query === "Retry Spot, Kyoto, Japan") {
        retrySpotRequests += 1;

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
            return retrySpotRequests === 1
              ? { places: [] }
              : {
                  places: [
                    {
                      displayName: { text: "Retry Spot" },
                      formattedAddress: "Retry District, Kyoto, Japan",
                      location: { latitude: 35.01, longitude: 135.76 },
                      googleMapsUri:
                        "https://www.google.com/maps/search/?api=1&query=35.01%2C135.76",
                    },
                  ],
                };
          },
        };
      }

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
          return { places: [] };
        },
      };
    },
    trip: {
      id: "trip-retry-geocode-cache",
      userSelection: {
        location: { label: "Kyoto, Japan" },
      },
      itinerary: {
        days: [
          {
            dayNumber: 1,
            title: "Kyoto retry",
            places: [{ placeName: "Retry Spot" }, { placeName: "Retry Spot" }],
          },
        ],
      },
    },
  });

  assert.equal(retrySpotRequests, 2);
  assert.equal(
    serviceResult.trip.itinerary.days[0].places[0].geocodeStatus,
    "unresolved"
  );
  assert.equal(
    serviceResult.trip.itinerary.days[0].places[1].geocodeStatus,
    "resolved"
  );
});
