import test from "node:test";
import assert from "node:assert/strict";
import {
  createTripRouteService,
  runDijkstraOnWeightMatrix,
  runPrimOnWeightMatrix,
} from "../server/services/routeOptimization.js";

test("runDijkstraOnWeightMatrix computes shortest graph distances", () => {
  const graph = [
    [0, 2, 10, Infinity],
    [2, 0, 2, 7],
    [10, 2, 0, 1],
    [Infinity, 7, 1, 0],
  ];

  const result = runDijkstraOnWeightMatrix(graph, 0);

  assert.deepEqual(result.distances, [0, 2, 4, 5]);
  assert.deepEqual(result.previous, [null, 0, 1, 2]);
});

test("runPrimOnWeightMatrix computes a minimum spanning tree", () => {
  const graph = [
    [0, 2, 3, Infinity],
    [2, 0, 1, 5],
    [3, 1, 0, 4],
    [Infinity, 5, 4, 0],
  ];

  const result = runPrimOnWeightMatrix(graph);

  assert.equal(result.totalWeight, 7);
  assert.deepEqual(result.edges, [
    { fromIndex: 0, toIndex: 1, weight: 2 },
    { fromIndex: 1, toIndex: 2, weight: 1 },
    { fromIndex: 2, toIndex: 3, weight: 4 },
  ]);
});

test("trip route service falls back to estimated haversine routing when Google APIs are unavailable", async () => {
  const service = createTripRouteService({
    resolvePlacesKey: () => "",
    resolveRoutesKey: () => "",
    fetchImpl: async () => {
      throw new Error("fetch should not be called for coordinate-only fallback");
    },
  });

  const routes = await service.getRoutesForTrip({
    trip: {
      id: "trip-1",
      userSelection: {
        location: { label: "Paris, France" },
      },
      itinerary: {
        days: [
          {
            dayNumber: 1,
            title: "Paris highlights",
            places: [
              {
                placeName: "Louvre Museum",
                geoCoordinates: { latitude: 48.8606, longitude: 2.3376 },
              },
              {
                placeName: "Arc de Triomphe",
                geoCoordinates: { latitude: 48.8738, longitude: 2.295 },
              },
              {
                placeName: "Eiffel Tower",
                geoCoordinates: { latitude: 48.8584, longitude: 2.2945 },
              },
            ],
          },
        ],
      },
    },
  });

  assert.equal(routes.dayCount, 1);
  assert.equal(routes.selectedDayDefault, 1);
  assert.equal(routes.defaultObjective, "fastest");
  assert.equal(routes.days[0].status, "ready");
  assert.equal(routes.days[0].algorithm, "dijkstra-fastest");
  assert.equal(routes.days[0].routeProvider, "estimated-haversine");
  assert.equal(routes.days[0].orderedStops.length, 3);
  assert.equal(routes.days[0].markers.length, 3);
  assert.equal(routes.days[0].viewportSource, "day_cluster");
  assert.equal(routes.days[0].localityLabel, "Paris");
  assert.equal(routes.days[0].segmentsDetailed.length, 2);
  assert.equal(routes.days[0].routeGraph.algorithm, "dijkstra-fastest");
  assert.deepEqual(routes.days[0].routeGraph.shortestPaths, [0, 344, 316]);
  assert.equal(
    routes.days[0].directionsUrl.startsWith("https://www.google.com/maps/dir/?"),
    true
  );
  assert.equal(routes.days[0].mst.edges.length, 2);
});

test("trip route service geocodes stops and uses Google route data when available", async () => {
  const requests = [];
  const stopFixtures = {
    "Paris, France": {
      formattedAddress: "Paris, France",
      location: { latitude: 48.8566, longitude: 2.3522 },
      viewport: {
        northEast: { latitude: 48.9021, longitude: 2.4699 },
        southWest: { latitude: 48.8156, longitude: 2.2241 },
      },
    },
    "Louvre Museum, Paris, France": {
      formattedAddress: "Rue de Rivoli, Paris, France",
      location: { latitude: 48.8606, longitude: 2.3376 },
      googleMapsUri: "https://maps.google.com/?q=louvre",
    },
    "Arc de Triomphe, Paris, France": {
      formattedAddress: "Place Charles de Gaulle, Paris, France",
      location: { latitude: 48.8738, longitude: 2.295 },
      googleMapsUri: "https://maps.google.com/?q=arc",
    },
    "Eiffel Tower, Paris, France": {
      formattedAddress: "Champ de Mars, Paris, France",
      location: { latitude: 48.8584, longitude: 2.2945 },
      googleMapsUri: "https://maps.google.com/?q=eiffel",
    },
  };
  const service = createTripRouteService({
    resolvePlacesKey: () => "places-key",
    resolveRoutesKey: () => "routes-key",
    fetchImpl: async (url, options = {}) => {
      const urlText = String(url);
      requests.push({ url: urlText, options });

      if (urlText.includes("places.googleapis.com")) {
        const query = JSON.parse(options.body).textQuery;
        const place = stopFixtures[query];

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
                  displayName: { text: query.split(",")[0] },
                  ...place,
                },
              ],
            };
          },
        };
      }

      if (urlText.includes("distanceMatrix")) {
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
            return [
              { originIndex: 0, destinationIndex: 1, distanceMeters: 6100, duration: "720s", condition: "ROUTE_EXISTS" },
              { originIndex: 0, destinationIndex: 2, distanceMeters: 2400, duration: "240s", condition: "ROUTE_EXISTS" },
              { originIndex: 1, destinationIndex: 0, distanceMeters: 6100, duration: "740s", condition: "ROUTE_EXISTS" },
              { originIndex: 1, destinationIndex: 2, distanceMeters: 4100, duration: "420s", condition: "ROUTE_EXISTS" },
              { originIndex: 2, destinationIndex: 0, distanceMeters: 2400, duration: "250s", condition: "ROUTE_EXISTS" },
              { originIndex: 2, destinationIndex: 1, distanceMeters: 4100, duration: "430s", condition: "ROUTE_EXISTS" },
            ];
          },
        };
      }

      if (urlText.includes("directions")) {
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
              routes: [
                {
                  distanceMeters: 6500,
                  duration: "670s",
                  polyline: {
                    encodedPolyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@",
                  },
                },
              ],
            };
          },
        };
      }

      throw new Error(`Unexpected URL: ${urlText}`);
    },
  });

  const routes = await service.getRoutesForTrip({
    trip: {
      id: "trip-2",
      userSelection: {
        location: { label: "Paris, France" },
      },
      itinerary: {
        days: [
          {
            dayNumber: 1,
            title: "Paris landmarks",
            places: [
              { placeName: "Louvre Museum" },
              { placeName: "Arc de Triomphe" },
              { placeName: "Eiffel Tower" },
            ],
          },
        ],
      },
    },
  });

  assert.equal(routes.days[0].routeProvider, "google-routes-matrix");
  assert.equal(routes.days[0].algorithm, "dijkstra-fastest");
  assert.equal(routes.days[0].localityLabel, "Paris");
  assert.equal(routes.days[0].viewportSource, "day_cluster");
  assert.equal(routes.days[0].segmentsDetailed.length, 2);
  assert.equal(routes.days[0].routeGraph.algorithm, "dijkstra-fastest");
  assert.deepEqual(routes.days[0].routeGraph.shortestPaths, [0, 670, 240]);
  assert.deepEqual(
    routes.days[0].orderedStops.map((stop) => stop.name),
    ["Louvre Museum", "Eiffel Tower", "Arc de Triomphe"]
  );
  assert.equal(routes.days[0].totalDistanceMeters, 6500);
  assert.equal(routes.days[0].totalDurationSeconds, 670);
  assert.equal(routes.days[0].polyline, "_p~iF~ps|U_ulLnnqC_mqNvxq`@");
  assert.equal(routes.selectedDayDefault, 1);
  assert.equal(routes.mapPolyline, "_p~iF~ps|U_ulLnnqC_mqNvxq`@");
  assert.deepEqual(
    routes.days[0].markers.map((marker) => marker.visitOrder),
    [1, 2, 3]
  );
  assert.equal(
    routes.days[0].directionsUrl.includes("waypoints=48.8584%2C2.2945"),
    true
  );
  assert.equal(routes.cityBounds !== null, true);
  assert.equal(routes.days[0].mapViewport !== null, true);
  assert.equal(
    routes.days[0].mapViewport.east - routes.days[0].mapViewport.west <
      routes.cityBounds.east - routes.cityBounds.west,
    true
  );

  const placeRequests = requests.filter((request) =>
    request.url.includes("places.googleapis.com")
  );
  assert.equal(placeRequests.length, 4);
});

test("trip route service preserves itinerary coordinates when aiPlan duplicates stop names", async () => {
  const service = createTripRouteService({
    resolvePlacesKey: () => "",
    resolveRoutesKey: () => "",
    fetchImpl: async () => {
      throw new Error("fetch should not be called for coordinate-only fallback");
    },
  });

  const routes = await service.getRoutesForTrip({
    trip: {
      id: "trip-ai-duplicate-stops",
      userSelection: {
        location: { label: "Kyoto, Japan" },
      },
      aiPlan: {
        days: [
          {
            day: 1,
            activities: ["Kinkaku-ji", "Fushimi Inari Shrine", "Nishiki Market"],
          },
        ],
      },
      itinerary: {
        days: [
          {
            dayNumber: 1,
            title: "Kyoto highlights",
            places: [
              {
                placeName: "Kinkaku-ji",
                geoCoordinates: { latitude: 35.0394, longitude: 135.7292 },
              },
              {
                placeName: "Fushimi Inari Shrine",
                geoCoordinates: { latitude: 34.9671, longitude: 135.7727 },
              },
              {
                placeName: "Nishiki Market",
                geoCoordinates: { latitude: 35.0045, longitude: 135.7648 },
              },
            ],
          },
        ],
      },
    },
  });

  assert.equal(routes.dayCount, 1);
  assert.equal(routes.days[0].status, "ready");
  assert.equal(routes.days[0].routeProvider, "estimated-haversine");
  assert.equal(routes.days[0].orderedStops.length, 3);
  assert.equal(routes.days[0].unresolvedStops.length, 0);
});

test("trip route service synthesizes fallback stops when a day has none", async () => {
  const requests = [];
  const service = createTripRouteService({
    resolvePlacesKey: () => "places-key",
    resolveRoutesKey: () => "routes-key",
    pythonRouteOptimizer: null,
    fetchImpl: async (url, options = {}) => {
      const urlText = String(url);
      requests.push({ url: urlText, options });

      if (urlText.includes("places.googleapis.com")) {
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
                  displayName: { text: "Senso-ji" },
                  formattedAddress: "Taito City, Tokyo",
                  location: { latitude: 35.7148, longitude: 139.7967 },
                  googleMapsUri: "https://maps.google.com/?q=sensoji",
                },
                {
                  displayName: { text: "Tokyo Skytree" },
                  formattedAddress: "Sumida City, Tokyo",
                  location: { latitude: 35.7101, longitude: 139.8107 },
                  googleMapsUri: "https://maps.google.com/?q=skytree",
                },
                {
                  displayName: { text: "Akihabara" },
                  formattedAddress: "Chiyoda City, Tokyo",
                  location: { latitude: 35.6984, longitude: 139.7730 },
                  googleMapsUri: "https://maps.google.com/?q=akiba",
                },
              ],
            };
          },
        };
      }

      if (urlText.includes("distanceMatrix")) {
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
            return [
              { originIndex: 0, destinationIndex: 1, distanceMeters: 1800, duration: "420s", condition: "ROUTE_EXISTS" },
              { originIndex: 0, destinationIndex: 2, distanceMeters: 2500, duration: "520s", condition: "ROUTE_EXISTS" },
              { originIndex: 1, destinationIndex: 0, distanceMeters: 1800, duration: "430s", condition: "ROUTE_EXISTS" },
              { originIndex: 1, destinationIndex: 2, distanceMeters: 2200, duration: "480s", condition: "ROUTE_EXISTS" },
              { originIndex: 2, destinationIndex: 0, distanceMeters: 2500, duration: "500s", condition: "ROUTE_EXISTS" },
              { originIndex: 2, destinationIndex: 1, distanceMeters: 2200, duration: "460s", condition: "ROUTE_EXISTS" },
            ];
          },
        };
      }

      if (urlText.includes("directions")) {
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
              routes: [
                {
                  distanceMeters: 6000,
                  duration: "720s",
                  polyline: {
                    encodedPolyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@",
                  },
                },
              ],
            };
          },
        };
      }

      throw new Error(`Unexpected URL: ${urlText}`);
    },
  });

  const routes = await service.getRoutesForTrip({
    trip: {
      id: "trip-tokyo",
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
    },
  });

  const day = routes.days[0];
  assert.equal(day.status, "ready");
  assert.equal(day.routeProvider, "google-routes-matrix");
  assert.equal(day.orderedStops.length, 3);
  assert.equal(day.orderedStops[0].name, "Senso-ji");
  assert.equal(day.localityLabel, "Taito");
  assert.equal(day.viewportSource, "day_cluster");
  assert.equal(day.inferredStopCount, 3);
  assert.equal(
    day.orderedStops.every((stop) => stop.source === "inferred"),
    true
  );
  assert.equal(day.markers.length, 3);
  assert.equal(day.totalDistanceMeters, 6000);
  assert.equal(day.totalDurationSeconds, 720);
  assert.equal(day.polyline, "_p~iF~ps|U_ulLnnqC_mqNvxq`@");

  const placeRequests = requests.filter((request) =>
    request.url.includes("places.googleapis.com")
  );
  assert.equal(placeRequests.length >= 2, true);
});

test("trip route service extracts clean place names from descriptive itinerary text", async () => {
  const placeRequests = [];
  const viewport = {
    northEast: { latitude: -8.2, longitude: 115.35 },
    southWest: { latitude: -8.95, longitude: 114.95 },
  };
  const geocodeFixtures = {
    "Bali, Indonesia": {
      displayName: { text: "Bali" },
      formattedAddress: "Bali, Indonesia",
      location: { latitude: -8.409518, longitude: 115.188919 },
      viewport,
      googleMapsUri: "https://maps.google.com/?q=bali",
    },
    "Uluwatu Temple, Bali, Indonesia": {
      displayName: { text: "Uluwatu Temple" },
      formattedAddress: "Pecatu, Bali, Indonesia",
      location: { latitude: -8.8291, longitude: 115.0849 },
      viewport,
      googleMapsUri: "https://maps.google.com/?q=uluwatu",
    },
    "Padang Padang Beach, Bali, Indonesia": {
      displayName: { text: "Padang Padang Beach" },
      formattedAddress: "Pecatu, Bali, Indonesia",
      location: { latitude: -8.8051, longitude: 115.1005 },
      viewport,
      googleMapsUri: "https://maps.google.com/?q=padang-padang",
    },
  };

  const service = createTripRouteService({
    resolvePlacesKey: () => "places-key",
    resolveRoutesKey: () => "",
    fetchImpl: async (url, options = {}) => {
      const urlText = String(url);

      if (!urlText.includes("places.googleapis.com")) {
        throw new Error(`Unexpected URL: ${urlText}`);
      }

      const query = JSON.parse(options.body).textQuery;
      placeRequests.push(query);
      const place = geocodeFixtures[query];

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
            places: place ? [place] : [],
          };
        },
      };
    },
  });

  const routes = await service.getRoutesForTrip({
    trip: {
      id: "trip-descriptive-text",
      userSelection: {
        location: { label: "Bali, Indonesia" },
      },
      itinerary: {
        days: [
          {
            dayNumber: 1,
            title: "Cliff temples and beach farewell",
            places: [
              {
                placeName:
                  "Visit the majestic Uluwatu Temple, perched on a cliff overlooking the Indian Ocean.",
              },
              {
                placeName:
                  "Spend some time at Padang Padang Beach or Bingin Beach, known for their beauty.",
              },
            ],
          },
        ],
      },
    },
  });

  assert.equal(routes.days[0].status, "ready");
  assert.equal(routes.days[0].routeProvider, "estimated-haversine");
  assert.deepEqual(
    routes.days[0].markers.map((marker) => marker.name),
    ["Uluwatu Temple", "Padang Padang Beach"]
  );
  assert.equal(
    placeRequests.includes("Uluwatu Temple, Bali, Indonesia"),
    true
  );
  assert.equal(
    placeRequests.includes("Padang Padang Beach, Bali, Indonesia"),
    true
  );
});

test("trip route service returns map-only payloads when only one stop is geocoded", async () => {
  const service = createTripRouteService({
    resolvePlacesKey: () => "",
    resolveRoutesKey: () => "",
    fetchImpl: async () => {
      throw new Error("fetch should not be called for persisted coordinate fallback");
    },
  });

  const routes = await service.getRoutesForTrip({
    trip: {
      id: "trip-map-only",
      userSelection: {
        location: { label: "Tokyo, Japan" },
      },
      itinerary: {
        days: [
          {
            dayNumber: 1,
            title: "Tokyo arrival",
            places: [
              {
                placeName: "Shibuya Crossing",
                location: "Shibuya City, Tokyo",
                mapsUrl: "https://maps.google.com/?q=shibuya",
                geoCoordinates: { latitude: 35.6595, longitude: 139.7005 },
              },
              {
                placeName: "Mystery Cafe",
                location: "Tokyo, Japan",
              },
            ],
          },
        ],
      },
      mapEnrichment: {
        status: "partial",
        geocodedStopCount: 1,
        unresolvedStopCount: 1,
        cityBounds: {
          north: 35.82,
          south: 35.55,
          east: 139.92,
          west: 139.55,
        },
      },
    },
  });

  assert.equal(routes.days[0].status, "map_only");
  assert.equal(routes.days[0].mapReady, true);
  assert.equal(routes.days[0].routeReady, false);
  assert.equal(routes.days[0].statusMessage, "Add at least two locations to generate a route.");
  assert.equal(routes.days[0].geocodedStopCount, 1);
  assert.equal(routes.days[0].unresolvedStopCount, 1);
  assert.equal(routes.days[0].markers.length, 1);
  assert.equal(routes.days[0].orderedStops.length, 1);
  assert.equal(routes.days[0].orderedStops[0].mapsUrl, "https://maps.google.com/?q=shibuya");
  assert.equal(routes.days[0].totalDurationSeconds, 0);
  assert.equal(routes.days[0].totalDistanceMeters, 0);
  assert.deepEqual(routes.days[0].cityBounds, {
    north: 35.82,
    south: 35.55,
    east: 139.92,
    west: 139.55,
  });
});

test("trip route service returns objective-ranked alternatives", async () => {
  const service = createTripRouteService({
    resolvePlacesKey: () => "",
    resolveRoutesKey: () => "",
    fetchImpl: async () => {
      throw new Error("fetch should not be called for coordinate-only fallback");
    },
  });

  const routes = await service.getRoutesForTrip({
    trip: {
      id: "trip-4",
      userSelection: {
        location: { label: "Rome, Italy" },
        objective: "best_experience",
        alternativesCount: 3,
        constraints: {
          dailyTimeLimitHours: 9,
          budgetCap: 2400,
          mobilityPref: "balanced",
          mealPrefs: ["Vegetarian"],
        },
      },
      itinerary: {
        days: [
          {
            dayNumber: 1,
            title: "Iconic Rome",
            places: [
              {
                placeName: "Colosseum",
                category: "historic landmark",
                geoCoordinates: { latitude: 41.8902, longitude: 12.4922 },
              },
              {
                placeName: "Trevi Fountain",
                category: "landmark",
                geoCoordinates: { latitude: 41.9009, longitude: 12.4833 },
              },
              {
                placeName: "Pantheon",
                category: "heritage",
                geoCoordinates: { latitude: 41.8986, longitude: 12.4768 },
              },
            ],
          },
        ],
      },
    },
    objective: "best_experience",
    alternativesCount: 3,
  });

  assert.equal(routes.objective, "best_experience");
  assert.equal(routes.alternativesCount, 3);
  assert.equal(routes.days[0].objective, "best_experience");
  assert.equal(routes.days[0].alternatives.length, 3);
  assert.equal(
    routes.days[0].alternatives.every((alternative) =>
      ["fastest", "cheapest", "best_experience"].includes(alternative.objective)
    ),
    true
  );
  assert.equal(typeof routes.days[0].explanation?.whySelected, "string");
});

test("trip route service derives stops from aiPlan activities and filters places outside the city bounds", async () => {
  const requests = [];
  const service = createTripRouteService({
    resolvePlacesKey: () => "places-key",
    resolveRoutesKey: () => "",
    pythonRouteOptimizer: null,
    fetchImpl: async (url, options = {}) => {
      const urlText = String(url);
      requests.push({ url: urlText, options });

      if (!urlText.includes("places.googleapis.com")) {
        throw new Error(`Unexpected URL: ${urlText}`);
      }

      const query = JSON.parse(options.body).textQuery;

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

      const placesByQuery = {
        "Shibuya Crossing, Tokyo, Japan": {
          displayName: { text: "Shibuya Crossing" },
          formattedAddress: "Shibuya City, Tokyo",
          location: { latitude: 35.6595, longitude: 139.7005 },
          googleMapsUri: "https://maps.google.com/?q=shibuya",
        },
        "Meiji Shrine, Tokyo, Japan": {
          displayName: { text: "Meiji Shrine" },
          formattedAddress: "Shibuya City, Tokyo",
          location: { latitude: 35.6764, longitude: 139.6993 },
          googleMapsUri: "https://maps.google.com/?q=meiji",
        },
        "Kyoto Imperial Palace, Tokyo, Japan": {
          displayName: { text: "Kyoto Imperial Palace" },
          formattedAddress: "Kamigyo Ward, Kyoto",
          location: { latitude: 35.0254, longitude: 135.7621 },
          googleMapsUri: "https://maps.google.com/?q=kyoto-palace",
        },
      };

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
            places: [placesByQuery[query]],
          };
        },
      };
    },
  });

  const routes = await service.getRoutesForTrip({
    trip: {
      id: "trip-ai-day",
      userSelection: {
        location: { label: "Tokyo, Japan" },
      },
      aiPlan: {
        days: [
          {
            day: 1,
            title: "Shibuya and shrine walk",
            activities: [
              "Shibuya Crossing",
              "Meiji Shrine",
              "Kyoto Imperial Palace",
            ],
          },
        ],
      },
      itinerary: {
        days: [
          {
            dayNumber: 1,
            title: "Tokyo intro",
            places: [],
          },
        ],
      },
    },
  });

  assert.equal(routes.selectedDayDefault, 1);
  assert.equal(routes.days[0].status, "ready");
  assert.equal(routes.days[0].routeProvider, "estimated-haversine");
  assert.deepEqual(
    routes.days[0].orderedStops.map((stop) => stop.name),
    ["Shibuya Crossing", "Meiji Shrine"]
  );
  assert.deepEqual(
    routes.days[0].unresolvedStops.map((stop) => stop.name),
    ["Kyoto Imperial Palace"]
  );
  assert.deepEqual(
    routes.days[0].markers.map((marker) => marker.name),
    ["Shibuya Crossing", "Meiji Shrine"]
  );

  const placeQueries = requests
    .filter((request) => request.url.includes("places.googleapis.com"))
    .map((request) => JSON.parse(request.options.body).textQuery);

  assert.deepEqual(placeQueries, [
    "Tokyo, Japan",
    "Shibuya Crossing, Tokyo, Japan",
    "Meiji Shrine, Tokyo, Japan",
    "Kyoto Imperial Palace, Tokyo, Japan",
  ]);
});

test("trip route service extracts place candidates from verbose aiPlan activities", async () => {
  const requests = [];
  const placesByQuery = {
    "Bali, Indonesia": {
      displayName: { text: "Bali" },
      formattedAddress: "Bali, Indonesia",
      location: { latitude: -8.4095, longitude: 115.1889 },
      viewport: {
        northEast: { latitude: -8.0, longitude: 115.72 },
        southWest: { latitude: -8.86, longitude: 114.43 },
      },
    },
    "Ubud Market, Bali, Indonesia": {
      displayName: { text: "Ubud Market" },
      formattedAddress: "Ubud, Gianyar Regency, Bali",
      location: { latitude: -8.5067, longitude: 115.2625 },
      googleMapsUri: "https://maps.google.com/?q=ubud-market",
    },
    "Monkey Forest, Bali, Indonesia": {
      displayName: { text: "Monkey Forest" },
      formattedAddress: "Ubud, Gianyar Regency, Bali",
      location: { latitude: -8.5186, longitude: 115.2582 },
      googleMapsUri: "https://maps.google.com/?q=monkey-forest",
    },
    "Ubud, Bali, Indonesia": {
      displayName: { text: "Ubud" },
      formattedAddress: "Ubud, Gianyar Regency, Bali",
      location: { latitude: -8.5069, longitude: 115.2625 },
      googleMapsUri: "https://maps.google.com/?q=ubud",
    },
  };

  const service = createTripRouteService({
    resolvePlacesKey: () => "places-key",
    resolveRoutesKey: () => "",
    pythonRouteOptimizer: null,
    fetchImpl: async (url, options = {}) => {
      const urlText = String(url);
      requests.push({ url: urlText, options });

      if (!urlText.includes("places.googleapis.com")) {
        throw new Error(`Unexpected URL: ${urlText}`);
      }

      const query = JSON.parse(options.body).textQuery;
      const place = placesByQuery[query];

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
            places: place ? [place] : [],
          };
        },
      };
    },
  });

  const routes = await service.getRoutesForTrip({
    trip: {
      id: "trip-bali-activity-extraction",
      userSelection: {
        location: { label: "Bali, Indonesia" },
      },
      aiPlan: {
        days: [
          {
            day: 1,
            title: "Arrival in Ubud & Monkey Forest Fun",
            activities: [
              "Explore Ubud Market",
              "Walk through Monkey Forest",
              "Sunset dinner in central Ubud",
            ],
          },
        ],
      },
      itinerary: {
        days: [
          {
            dayNumber: 1,
            title: "Arrival in Ubud & Monkey Forest Fun",
            places: [],
          },
        ],
      },
    },
  });

  assert.equal(routes.days[0].status, "ready");
  assert.equal(routes.days[0].markers.length, 3);
  assert.equal(routes.days[0].localityLabel, "Ubud");
  assert.equal(routes.days[0].viewportSource, "day_cluster");
  assert.deepEqual(
    routes.days[0].orderedStops.map((stop) => stop.name),
    ["Ubud Market", "Ubud", "Monkey Forest"]
  );

  const placeQueries = requests
    .filter((request) => request.url.includes("places.googleapis.com"))
    .map((request) => JSON.parse(request.options.body).textQuery);

  assert.deepEqual(placeQueries, [
    "Bali, Indonesia",
    "Ubud Market, Bali, Indonesia",
    "Monkey Forest, Bali, Indonesia",
    "Ubud, Bali, Indonesia",
  ]);
});

test("trip route service retries city fallback places after geocoding collapses", async () => {
  const requests = [];
  const service = createTripRouteService({
    resolvePlacesKey: () => "places-key",
    resolveRoutesKey: () => "",
    pythonRouteOptimizer: null,
    fetchImpl: async (url, options = {}) => {
      const urlText = String(url);
      requests.push({ url: urlText, options });

      if (!urlText.includes("places.googleapis.com")) {
        throw new Error(`Unexpected URL: ${urlText}`);
      }

      const query = JSON.parse(options.body).textQuery;

      if (query === "Bali, Indonesia") {
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
                  displayName: { text: "Bali" },
                  formattedAddress: "Bali, Indonesia",
                  location: { latitude: -8.4095, longitude: 115.1889 },
                  viewport: {
                    northEast: { latitude: -8.0, longitude: 115.72 },
                    southWest: { latitude: -8.86, longitude: 114.43 },
                  },
                },
              ],
            };
          },
        };
      }

      if (
        query === "Hidden Cliff Temple, Bali, Indonesia" ||
        query === "Sidemen Village, Bali, Indonesia" ||
        query === "Temple Trails in Sidemen in Bali, Indonesia"
      ) {
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
      }

      if (query === "top sights in Sidemen, Bali, Indonesia") {
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
                  displayName: { text: "Sidemen Rice Terrace" },
                  formattedAddress: "Sidemen, Bali",
                  location: { latitude: -8.4662, longitude: 115.4444 },
                  googleMapsUri: "https://maps.google.com/?q=sidemen-rice-terrace",
                },
                {
                  displayName: { text: "Bukit Jambul" },
                  formattedAddress: "Karangasem Regency, Bali",
                  location: { latitude: -8.4459, longitude: 115.4275 },
                  googleMapsUri: "https://maps.google.com/?q=bukit-jambul",
                },
                {
                  displayName: { text: "Gembleng Waterfall" },
                  formattedAddress: "Sidemen, Bali",
                  location: { latitude: -8.5001, longitude: 115.4572 },
                  googleMapsUri: "https://maps.google.com/?q=gembleng-waterfall",
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
  });

  const routes = await service.getRoutesForTrip({
    trip: {
      id: "trip-bali-fallback-recovery",
      userSelection: {
        location: { label: "Bali, Indonesia" },
      },
      aiPlan: {
        days: [
          {
            day: 1,
            title: "Temple Trails in Sidemen",
            activities: ["Hidden Cliff Temple", "Sidemen Village"],
          },
        ],
      },
      itinerary: {
        days: [
          {
            dayNumber: 1,
            title: "Temple Trails in Sidemen",
            places: [],
          },
        ],
      },
    },
  });

  assert.equal(routes.days[0].status, "ready");
  assert.equal(routes.days[0].markers.length, 3);
  assert.equal(routes.days[0].localityLabel, "Sidemen");
  assert.equal(routes.days[0].viewportSource, "day_cluster");
  assert.equal(routes.days[0].inferredStopCount, 3);
  assert.equal(
    routes.days[0].orderedStops.every((stop) => stop.source === "inferred"),
    true
  );
  assert.equal(
    routes.days[0].warning.includes(
      "Some day stops were inferred from Google Places because the itinerary text could not be geocoded directly."
    ),
    true
  );
  assert.deepEqual(
    routes.days[0].unresolvedStops.map((stop) => stop.name),
    ["Hidden Cliff Temple", "Sidemen Village"]
  );

  const placeQueries = requests
    .filter((request) => request.url.includes("places.googleapis.com"))
    .map((request) => JSON.parse(request.options.body).textQuery);

  assert.equal(placeQueries.includes("top sights in Sidemen, Bali, Indonesia"), true);
});
