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
                  displayName: { text: "Tokyo" },
                  formattedAddress: "Tokyo, Japan",
                  location: { latitude: 35.6762, longitude: 139.6503 },
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

      if (query === "Shibuya Crossing, Tokyo, Japan") {
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
                  displayName: { text: "Shibuya Crossing" },
                  formattedAddress: "Shibuya City, Tokyo",
                  location: { latitude: 35.6595, longitude: 139.7005 },
                  googleMapsUri: "https://maps.google.com/?q=shibuya",
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
    },
  });

  assert.equal(serviceResult.changed, true);
  assert.equal(serviceResult.trip.itinerary.days[0].places[0].geocodeStatus, "resolved");
  assert.equal(
    serviceResult.trip.itinerary.days[0].places[0].geocodeSource,
    "google_places"
  );
  assert.equal(
    serviceResult.trip.itinerary.days[0].places[0].location,
    "Shibuya City, Tokyo"
  );
  assert.equal(
    serviceResult.trip.itinerary.days[0].places[0].mapsUrl,
    "https://maps.google.com/?q=shibuya"
  );
  assert.equal(
    serviceResult.trip.itinerary.days[0].places[1].geocodeStatus,
    "unresolved"
  );
  assert.equal(serviceResult.stats.status, "partial");
  assert.equal(serviceResult.stats.geocodedStopCount, 1);
  assert.equal(serviceResult.stats.unresolvedStopCount, 1);
  assert.equal(serviceResult.stats.hasCityBounds, true);
  assert.deepEqual(serviceResult.trip.mapEnrichment.cityBounds, {
    north: 35.82,
    south: 35.55,
    east: 139.92,
    west: 139.55,
  });
  assert.deepEqual(requests, [
    "Tokyo, Japan",
    "Shibuya Crossing, Tokyo, Japan",
    "Unknown Hidden Spot, Tokyo, Japan",
  ]);
});
