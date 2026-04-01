import test from "node:test";
import assert from "node:assert/strict";
import { buildTripCityMapPayload } from "../server/services/tripCityMap.js";

test("buildTripCityMapPayload keeps only in-outline resolved places as map pins", () => {
  const cityMap = buildTripCityMapPayload({
    trip: {
      userSelection: {
        location: { label: "Tokyo, Japan" },
      },
      mapEnrichment: {
        cityBounds: {
          north: 35.82,
          south: 35.55,
          east: 139.92,
          west: 139.55,
        },
        markerDays: [
          {
            dayNumber: 1,
            title: "Tokyo intro",
            places: [
              {
                placeName: "Shibuya Crossing",
                location: "Shibuya, Tokyo",
                mapsUrl: "https://www.google.com/maps/search/?api=1&query=35.6595%2C139.7005",
                geoCoordinates: { latitude: 35.6595, longitude: 139.7005 },
                geocodeStatus: "resolved",
              },
              {
                placeName: "Faraway Place",
                location: "Outside Tokyo",
                mapsUrl: "https://www.google.com/maps/search/?api=1&query=35.79%2C139.91",
                geoCoordinates: { latitude: 35.79, longitude: 139.91 },
                geocodeStatus: "resolved",
              },
              {
                placeName: "Unknown Stop",
                geocodeStatus: "unresolved",
              },
            ],
          },
        ],
      },
    },
    basemap: {
      cityBounds: {
        north: 35.82,
        south: 35.55,
        east: 139.92,
        west: 139.55,
      },
      outline: {
        source: "administrative_boundary",
        polygons: [
          [
            { latitude: 35.57, longitude: 139.58 },
            { latitude: 35.8, longitude: 139.6 },
            { latitude: 35.79, longitude: 139.82 },
            { latitude: 35.6, longitude: 139.8 },
            { latitude: 35.57, longitude: 139.58 },
          ],
        ],
      },
    },
  });

  assert.equal(cityMap.outline?.source, "administrative_boundary");
  assert.equal(cityMap.mapSource, "fallback_bounds");
  assert.equal(cityMap.mappedPlaceCount, 1);
  assert.equal(cityMap.unresolvedPlaceCount, 2);
  assert.equal(cityMap.markers.length, 1);
  assert.equal(cityMap.markers[0].name, "Shibuya Crossing");
  assert.equal(cityMap.days[0].places[0].isPinned, true);
  assert.equal(cityMap.days[0].places[1].isPinned, false);
});
