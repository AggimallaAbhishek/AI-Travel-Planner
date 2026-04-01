import test from "node:test";
import assert from "node:assert/strict";
import { createUnifiedTripMapService } from "../server/services/unifiedTripMap.js";

test("unified trip map service aggregates route, recommendation, and transit layers", async () => {
  const service = createUnifiedTripMapService({
    async getRoutesForTripImpl() {
      return {
        tripId: "trip-1",
        destination: "Tokyo, Japan",
        selectedDayDefault: 1,
        cityBounds: {
          north: 35.72,
          south: 35.62,
          east: 139.83,
          west: 139.68,
        },
        sourceProvenance: {
          primaryProvider: "google-routes",
          sources: [{ provider: "google-routes", sourceType: "routing-api" }],
        },
        days: [
          {
            dayNumber: 1,
            title: "Tokyo highlights",
            status: "ready",
            statusMessage: "Optimized route ready.",
            algorithm: "dijkstra-fastest",
            objective: "fastest",
            objectiveLabel: "Fastest",
            routeProvider: "google-routes-matrix",
            totalDistanceMeters: 6400,
            totalDurationSeconds: 820,
            unresolvedStopCount: 1,
            warning: "",
            orderedStops: [
              {
                id: "stop-1",
                name: "Senso-ji",
                location: "Asakusa, Tokyo",
                geoCoordinates: { latitude: 35.7148, longitude: 139.7967 },
                mapsUrl: "https://maps.example/sensoji",
                source: "itinerary",
                geocodeSource: "world_poi_index",
                category: "temple",
              },
              {
                id: "stop-2",
                name: "Tokyo Skytree",
                location: "Sumida, Tokyo",
                geoCoordinates: { latitude: 35.7101, longitude: 139.8107 },
                mapsUrl: "https://maps.example/skytree",
                source: "itinerary",
                geocodeSource: "stored",
                category: "landmark",
              },
            ],
            segmentsDetailed: [
              {
                fromId: "stop-1",
                toId: "stop-2",
                distanceMeters: 1800,
                durationSeconds: 420,
              },
            ],
            alternatives: [
              {
                rank: 1,
                objective: "fastest",
                objectiveLabel: "Fastest",
                algorithm: "dijkstra-fastest",
                paretoScore: 1,
                totalDistanceMeters: 6400,
                totalDurationSeconds: 820,
                estimatedCost: 320,
                experienceScore: 12.4,
                tradeoffDelta: {
                  minutesVsFastest: 0,
                  costVsFastest: 0,
                  experienceVsFastest: 0,
                },
              },
            ],
            unresolvedStops: [{ id: "stop-x", name: "Hidden alley" }],
          },
        ],
      };
    },
    async getRecommendationsForDestinationImpl() {
      return {
        destination: "Tokyo, Japan",
        provider: "mock",
        sourceProvenance: {
          sources: [{ provider: "mock", sourceType: "generated" }],
        },
        hotels: [
          {
            name: "Park Hotel Tokyo",
            location: "Shiodome, Tokyo",
            category: "hotel",
          },
        ],
        restaurants: [
          {
            name: "Ichiran Shibuya",
            location: "Shibuya, Tokyo",
            category: "restaurant",
          },
        ],
      };
    },
    async resolvePlaceImpl({ query }) {
      if (query.includes("Park Hotel Tokyo")) {
        return {
          id: "poi-hotel-1",
          name: "Park Hotel Tokyo",
          categories: ["hotel"],
          locality: "Tokyo",
          countryName: "Japan",
          geoCoordinates: { latitude: 35.664, longitude: 139.7597 },
          mapsUrl: "https://maps.example/hotel",
          confidence: 0.82,
        };
      }

      if (query.includes("Ichiran Shibuya")) {
        return {
          id: "poi-restaurant-1",
          name: "Ichiran Shibuya",
          categories: ["restaurant"],
          locality: "Tokyo",
          countryName: "Japan",
          geoCoordinates: { latitude: 35.6598, longitude: 139.7004 },
          mapsUrl: "https://maps.example/ichiran",
          confidence: 0.8,
        };
      }

      return null;
    },
    async listDestinationPoisImpl({ categories }) {
      const key = Array.isArray(categories) ? categories.join(",") : String(categories);

      if (key === "airport") {
        return [
          {
            id: "airport-1",
            name: "Haneda Airport",
            categories: ["airport"],
            locality: "Tokyo",
            countryName: "Japan",
            geoCoordinates: { latitude: 35.5494, longitude: 139.7798 },
            mapsUrl: "https://maps.example/haneda",
            confidence: 0.92,
          },
        ];
      }

      if (key === "rail_station,metro_station") {
        return [
          {
            id: "station-1",
            name: "Tokyo Station",
            categories: ["rail_station"],
            locality: "Tokyo",
            countryName: "Japan",
            geoCoordinates: { latitude: 35.6812, longitude: 139.7671 },
            mapsUrl: "https://maps.example/tokyo-station",
            confidence: 0.91,
          },
        ];
      }

      if (key === "bus_terminal") {
        return [
          {
            id: "bus-1",
            name: "Busta Shinjuku",
            categories: ["bus_terminal"],
            locality: "Tokyo",
            countryName: "Japan",
            geoCoordinates: { latitude: 35.6886, longitude: 139.7006 },
            mapsUrl: "https://maps.example/busta",
            confidence: 0.79,
          },
        ];
      }

      return [];
    },
  });

  const tripMap = await service.getUnifiedTripMap({
    trip: {
      id: "trip-1",
      userSelection: {
        location: { label: "Tokyo, Japan" },
      },
    },
  });

  assert.equal(tripMap.destination, "Tokyo, Japan");
  assert.equal(tripMap.activeDayDefault, 1);
  assert.equal(tripMap.days.length, 1);
  assert.equal(tripMap.days[0].stops.length, 2);
  assert.equal(tripMap.days[0].segments[0].label, "1.8 km");
  assert.equal(tripMap.layers.hotels.length, 1);
  assert.equal(tripMap.layers.restaurants.length, 1);
  assert.equal(tripMap.layers.airports.length, 1);
  assert.equal(tripMap.layers.railMetroStations.length, 1);
  assert.equal(tripMap.layers.busTerminals.length, 1);
  assert.equal(tripMap.stats.stopCount, 2);
  assert.equal(tripMap.stats.unresolvedCount, 1);
  assert.equal(typeof tripMap.latencyBreakdownMs.totalMs, "number");
});

test("unified trip map service tolerates missing recommendation and transit layers", async () => {
  const service = createUnifiedTripMapService({
    async getRoutesForTripImpl() {
      return {
        destination: "Bali, Indonesia",
        selectedDayDefault: 1,
        cityBounds: null,
        sourceProvenance: { primaryProvider: "world_poi_index", sources: [] },
        days: [
          {
            dayNumber: 1,
            title: "Uluwatu",
            status: "ready",
            algorithm: "dijkstra-fastest",
            objective: "fastest",
            objectiveLabel: "Fastest",
            routeProvider: "estimated-haversine",
            totalDistanceMeters: 2400,
            totalDurationSeconds: 300,
            unresolvedStopCount: 0,
            orderedStops: [
              {
                id: "a",
                name: "Uluwatu Temple",
                location: "Bali, Indonesia",
                geoCoordinates: { latitude: -8.8291, longitude: 115.0849 },
                source: "itinerary",
                geocodeSource: "world_poi_index",
                category: "temple",
              },
              {
                id: "b",
                name: "Padang Padang Beach",
                location: "Bali, Indonesia",
                geoCoordinates: { latitude: -8.8051, longitude: 115.1005 },
                source: "itinerary",
                geocodeSource: "world_poi_index",
                category: "beach",
              },
            ],
            segmentsDetailed: [
              {
                fromId: "a",
                toId: "b",
                distanceMeters: 2400,
                durationSeconds: 300,
              },
            ],
            alternatives: [],
            unresolvedStops: [],
          },
        ],
      };
    },
    async getRecommendationsForDestinationImpl() {
      return {
        destination: "Bali, Indonesia",
        provider: "mock",
        sourceProvenance: { sources: [] },
        hotels: [],
        restaurants: [],
      };
    },
    async resolvePlaceImpl() {
      return null;
    },
    async listDestinationPoisImpl() {
      return [];
    },
  });

  const tripMap = await service.getUnifiedTripMap({
    trip: {
      id: "trip-2",
      userSelection: {
        location: { label: "Bali, Indonesia" },
      },
    },
  });

  assert.equal(tripMap.layers.hotels.length, 0);
  assert.equal(tripMap.layers.restaurants.length, 0);
  assert.equal(tripMap.layers.airports.length, 0);
  assert.equal(tripMap.days[0].segments.length, 1);
  assert.equal(tripMap.viewport.center !== null, true);
});
