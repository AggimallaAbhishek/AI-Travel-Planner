import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFallbackGeneratedTrip,
  buildTripPrompt,
  getUserSelectionErrors,
  normalizeGeneratedTrip,
  normalizeStoredTrip,
  normalizeUserSelection,
  parseAiTripPayload,
  sortTripsNewestFirst,
} from "../../shared/trips.js";

test("normalizeUserSelection maps legacy keys into canonical shape", () => {
  const normalized = normalizeUserSelection({
    destination: "Kyoto",
    noOfDays: "5",
    budget: "Luxury",
    travelWith: "Friends",
  });

  assert.deepEqual(normalized, {
    location: { label: "Kyoto" },
    days: 5,
    budget: "Luxury",
    travelers: "Friends",
    travelType: "",
    travelerCount: null,
    objective: "best_experience",
    constraints: {
      dailyTimeLimitHours: 10,
      budgetCap: null,
      mobilityPref: "balanced",
      mealPrefs: [],
    },
    alternativesCount: 3,
  });
});

test("getUserSelectionErrors flags invalid duration range", () => {
  const errors = getUserSelectionErrors({
    location: { label: "Rome" },
    days: 31,
    budget: "Moderate",
    travelers: "Just Me",
  });

  assert.ok(errors.includes("Trip duration must be between 1 and 30 days."));
});

test("parseAiTripPayload accepts fenced JSON payloads", () => {
  const parsed = parseAiTripPayload(`\`\`\`json
{"hotels":[],"itinerary":{"days":[]}}
\`\`\``);

  assert.deepEqual(parsed, {
    hotels: [],
    itinerary: {
      days: [],
    },
  });
});

test("parseAiTripPayload extracts JSON from noisy model output", () => {
  const parsed = parseAiTripPayload(`
Sure, here is the itinerary:
{"destination":"Rome","days":[{"day":1,"title":"Arrival","activities":["City walk"],"estimated_cost":"$90-$140","tips":"Book museum tickets early."}],"total_estimated_cost":"$360-$560","travel_tips":["Carry a refillable water bottle."]}
  `);

  assert.equal(parsed.destination, "Rome");
  assert.equal(parsed.days[0].day, 1);
});

test("normalizeGeneratedTrip normalizes itinerary day objects and defaults", () => {
  const normalized = normalizeGeneratedTrip({
    hotels: [
      {
        name: "Central Stay",
        address: "Downtown",
        rating: "4.6",
      },
    ],
    itinerary: {
      day2: [
        {
          name: "Museum",
          details: "Art and history",
        },
      ],
      day1: [
        {
          name: "Old Town Walk",
          travelTime: "15 min",
        },
      ],
    },
  });

  assert.equal(normalized.hotels.length, 1);
  assert.equal(normalized.hotels[0].hotelName, "Central Stay");
  assert.equal(normalized.itinerary.days.length, 2);
  assert.equal(normalized.itinerary.days[0].dayNumber, 1);
  assert.equal(normalized.itinerary.days[1].dayNumber, 2);
  assert.equal(normalized.aiPlan.days.length, 2);
});

test("normalizeGeneratedTrip maps strict Gemini JSON shape to aiPlan and itinerary", () => {
  const normalized = normalizeGeneratedTrip({
    destination: "Bali",
    days: [
      {
        day: 1,
        title: "Arrival and beach sunset",
        activities: ["Hotel check-in", "Seminyak Beach walk", "Sunset dinner"],
        estimated_cost: "$80-$130",
        tips: "Keep local cash for small vendors.",
      },
    ],
    total_estimated_cost: "$320-$520",
    travel_tips: ["Use ride-hailing apps for reliable transport."],
  });

  assert.equal(normalized.aiPlan.destination, "Bali");
  assert.equal(normalized.aiPlan.days.length, 1);
  assert.equal(normalized.aiPlan.days[0].activities.length, 3);
  assert.equal(normalized.aiPlan.totalEstimatedCost, "$320-$520");
  assert.equal(normalized.itinerary.days[0].places[0].placeName, "Hotel check-in");
});

test("buildFallbackGeneratedTrip returns deterministic minimum itinerary", () => {
  const fallback = buildFallbackGeneratedTrip({
    location: { label: "Tokyo" },
    days: 2,
    budget: "Cheap",
    travelers: "Just Me",
  });

  assert.equal(fallback.aiPlan.destination, "Tokyo");
  assert.equal(fallback.aiPlan.days.length, 2);
  assert.equal(fallback.itinerary.days.length, 2);
  assert.ok(fallback.aiPlan.totalEstimatedCost.includes("$"));
});

test("sortTripsNewestFirst sorts by descending createdAt", () => {
  const trips = sortTripsNewestFirst([
    { id: "old", createdAt: "2024-01-01T00:00:00.000Z" },
    { id: "new", createdAt: "2025-01-01T00:00:00.000Z" },
    { id: "mid", createdAt: "2024-07-01T00:00:00.000Z" },
  ]);

  assert.deepEqual(trips.map((trip) => trip.id), ["new", "mid", "old"]);
});

test("buildTripPrompt contains all normalized user selection fields", () => {
  const prompt = buildTripPrompt({
    location: { label: "Seoul" },
    days: 4,
    budget: "Cheap",
    travelers: "Family",
    travelType: "Relaxation",
    travelerCount: 3,
  });

  assert.ok(prompt.includes("Destination: Seoul"));
  assert.ok(prompt.includes("Duration: 4 day(s)"));
  assert.ok(prompt.includes("Budget: Cheap"));
  assert.ok(prompt.includes("Travel Type: Relaxation"));
  assert.ok(prompt.includes("Number of Travelers: 3"));
  assert.ok(prompt.includes("\"total_estimated_cost\""));
});

test("normalizeStoredTrip preserves persisted place geocodes and map enrichment", () => {
  const trip = normalizeStoredTrip({
    id: "trip-persisted-map-data",
    ownerId: "user-1",
    ownerEmail: "owner@example.com",
    createdAt: "2026-04-01T10:00:00.000Z",
    updatedAt: "2026-04-01T10:05:00.000Z",
    userSelection: {
      location: { label: "Tokyo, Japan" },
      days: 2,
      budget: "Moderate",
      travelers: "Friends",
    },
    itinerary: {
      days: [
        {
          dayNumber: 1,
          title: "Tokyo intro",
          places: [
            {
              placeName: "Shibuya Crossing",
              placeDetails: "Famous scramble crossing.",
              location: "Shibuya City, Tokyo",
              mapsUrl: "https://maps.google.com/?q=shibuya",
              geoCoordinates: { latitude: 35.6595, longitude: 139.7005 },
              geocodeStatus: "resolved",
              geocodeSource: "google_places",
              geocodedAt: "2026-04-01T10:01:00.000Z",
            },
            {
              placeName: "Mystery Cafe",
              geocodeStatus: "unresolved",
            },
          ],
        },
      ],
    },
    aiPlan: {
      destination: "Tokyo, Japan",
      days: [
        {
          day: 1,
          title: "Tokyo intro",
          activities: ["Shibuya Crossing", "Mystery Cafe"],
          estimatedCost: "$80-$120",
          tips: "Start early.",
        },
      ],
      totalEstimatedCost: "$160-$240",
      travelTips: ["Carry cash."],
    },
    mapEnrichment: {
      status: "partial",
      lastAttemptedAt: "2026-04-01T10:01:00.000Z",
      geocodedStopCount: 1,
      unresolvedStopCount: 1,
      cityBounds: {
        north: 35.82,
        south: 35.55,
        east: 139.92,
        west: 139.55,
      },
    },
  });

  assert.equal(trip.itinerary.days[0].places[0].location, "Shibuya City, Tokyo");
  assert.equal(
    trip.itinerary.days[0].places[0].mapsUrl,
    "https://maps.google.com/?q=shibuya"
  );
  assert.equal(trip.itinerary.days[0].places[0].geocodeStatus, "resolved");
  assert.equal(trip.itinerary.days[0].places[0].geocodeSource, "google_places");
  assert.equal(
    trip.itinerary.days[0].places[0].geocodedAt,
    "2026-04-01T10:01:00.000Z"
  );
  assert.equal(trip.itinerary.days[0].places[1].geocodeStatus, "unresolved");
  assert.equal(trip.mapEnrichment.status, "partial");
  assert.equal(trip.mapEnrichment.geocodedStopCount, 1);
  assert.equal(trip.mapEnrichment.unresolvedStopCount, 1);
  assert.deepEqual(trip.mapEnrichment.cityBounds, {
    north: 35.82,
    south: 35.55,
    east: 139.92,
    west: 139.55,
  });
});
