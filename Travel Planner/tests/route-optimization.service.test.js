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
  assert.equal(routes.days[0].status, "ready");
  assert.equal(routes.days[0].routeProvider, "estimated-haversine");
  assert.equal(routes.days[0].orderedStops.length, 3);
  assert.equal(routes.days[0].markers.length, 3);
  assert.equal(
    routes.days[0].directionsUrl.startsWith("https://www.google.com/maps/dir/?"),
    true
  );
  assert.equal(routes.days[0].mst.edges.length, 2);
});

test("trip route service geocodes stops and uses Google route data when available", async () => {
  const requests = [];
  const stopFixtures = {
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
    pythonRouteOptimizer: async () => ({
      algorithm: "python-nearest-neighbor-2opt",
      visitOrder: [0, 2, 1],
      shortestPathsFromOrigin: [0, 420, 240],
      previous: [null, 2, 0],
      mst: {
        totalWeight: 660,
        edges: [
          { fromIndex: 0, toIndex: 2, weight: 240 },
          { fromIndex: 2, toIndex: 1, weight: 420 },
        ],
      },
    }),
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
  assert.equal(routes.days[0].algorithm, "python-nearest-neighbor-2opt");
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

  const placeRequests = requests.filter((request) =>
    request.url.includes("places.googleapis.com")
  );
  assert.equal(placeRequests.length, 4);
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
  assert.equal(day.markers.length, 3);
  assert.equal(day.totalDistanceMeters, 6000);
  assert.equal(day.totalDurationSeconds, 720);
  assert.equal(day.polyline, "_p~iF~ps|U_ulLnnqC_mqNvxq`@");

  const placeRequests = requests.filter((request) =>
    request.url.includes("places.googleapis.com")
  );
  assert.equal(placeRequests.length, 2);
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
