import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBudgetBreakdown,
  buildTripPdfModel,
  extractRoutePoints,
  parseBudgetRange,
} from "../src/lib/trip-pdf/model.js";

function buildSampleTrip(overrides = {}) {
  return {
    userSelection: {
      location: { label: "Paris" },
      budget: "Luxury",
      travelers: "Couple",
      travelType: "Relaxed",
      ...overrides.userSelection,
    },
    createdAt: "2026-01-05T10:00:00.000Z",
    aiPlan: {
      totalEstimatedCost: "$1,200 - $1,800",
      days: [
        {
          day: 1,
          title: "Arrival and Riverside Walk",
          activities: ["Hotel check-in", "Seine walk", "Dinner cruise"],
          estimatedCost: "$220",
          tips: "Book dinner cruise slots early.",
        },
      ],
      travelTips: ["Carry a metro card for quick transfers."],
      ...overrides.aiPlan,
    },
    itinerary: {
      days: [
        {
          dayNumber: 1,
          title: "Arrival and Riverside Walk",
          places: [
            {
              placeName: "Eiffel Tower",
              placeDetails: "Landmark stop",
              ticketPricing: "€30",
              geoCoordinates: { latitude: 48.8584, longitude: 2.2945 },
            },
          ],
        },
      ],
      ...overrides.itinerary,
    },
    hotels: [
      {
        hotelName: "Riverfront Suites",
        hotelAddress: "Paris Center",
        rating: 4.6,
        price: "$$$$",
        geoCoordinates: { latitude: 48.86, longitude: 2.33 },
      },
    ],
    ...overrides,
  };
}

const SAMPLE_RECOMMENDATIONS = {
  warning: "Live provider returned partial data.",
  hotels: [
    {
      name: "Palais Stay",
      location: "Louvre District",
      rating: 4.7,
      priceLabel: "$$$$",
      geoCoordinates: { latitude: 48.862, longitude: 2.336 },
    },
  ],
  restaurants: [
    {
      name: "Cafe Lumiere",
      location: "Montmartre",
      rating: 4.4,
      priceLabel: "$$",
      geoCoordinates: { latitude: 48.8867, longitude: 2.3431 },
    },
  ],
};

test("buildTripPdfModel returns robust defaults when key fields are missing", () => {
  const model = buildTripPdfModel({
    trip: {
      userSelection: {
        location: { label: "" },
        budget: "",
        travelers: "",
      },
      aiPlan: {},
      itinerary: {},
    },
    recommendations: {},
    generatedAt: "2026-04-02T12:00:00.000Z",
  });

  assert.equal(model.destination, "Unknown destination");
  assert.equal(model.itinerary.days.length, 1);
  assert.equal(model.recommendations.hotels.length, 1);
  assert.equal(model.recommendations.restaurants.length, 1);
  assert.equal(model.travelTips.length > 0, true);
});

test("buildTripPdfModel prefers aiPlan days and enriches map/overview sections", () => {
  const trip = buildSampleTrip();

  const model = buildTripPdfModel({
    trip,
    recommendations: SAMPLE_RECOMMENDATIONS,
    generatedAt: "2026-04-02T12:00:00.000Z",
  });

  assert.equal(model.destination, "Paris");
  assert.equal(model.itinerary.days.length, 1);
  assert.equal(model.itinerary.days[0].title, "Arrival and Riverside Walk");
  assert.equal(model.recommendations.hotels[0].name, "Palais Stay");
  assert.equal(model.recommendations.restaurants[0].name, "Cafe Lumiere");
  assert.equal(model.mapRoute.routePoints.length >= 2, true);
  assert.equal(model.overview.totalEstimatedCost, "$1,200 - $1,800");
});

test("buildTripPdfModel falls back to itinerary days when aiPlan days are absent", () => {
  const trip = buildSampleTrip({
    aiPlan: {
      totalEstimatedCost: "$500 - $800",
      days: [],
      travelTips: [],
    },
    itinerary: {
      days: [
        {
          dayNumber: 1,
          title: "Museum and Old Town",
          places: [
            {
              placeName: "Louvre Museum",
              placeDetails: "Reserve timed slots.",
              ticketPricing: "€20",
              geoCoordinates: { latitude: 48.8606, longitude: 2.3376 },
            },
          ],
        },
      ],
    },
  });

  const model = buildTripPdfModel({
    trip,
    recommendations: SAMPLE_RECOMMENDATIONS,
  });

  assert.equal(model.itinerary.days[0].title, "Museum and Old Town");
  assert.equal(model.itinerary.days[0].activities[0], "Louvre Museum");
  assert.equal(model.itinerary.days[0].estimatedCost, "€20");
});

test("parseBudgetRange handles symbols and malformed values", () => {
  assert.deepEqual(parseBudgetRange("₹45,000 - ₹70,000"), {
    currency: "₹",
    min: 45000,
    max: 70000,
  });

  assert.equal(parseBudgetRange("Budget flexible"), null);
});

test("buildBudgetBreakdown derives travel/stay/food slices from total range", () => {
  const breakdown = buildBudgetBreakdown("$2,000 - $3,000");

  assert.equal(breakdown.length, 4);
  assert.equal(breakdown[0].label, "Travel");
  assert.equal(breakdown[1].label, "Stay");
  assert.equal(breakdown[2].label, "Food");
  assert.equal(breakdown[0].amount.includes("$"), true);
});

test("extractRoutePoints deduplicates route coordinates across sources", () => {
  const points = extractRoutePoints({
    days: [
      {
        routePoints: [
          { label: "A", latitude: 48.8584, longitude: 2.2945 },
          { label: "A duplicate", latitude: 48.8584, longitude: 2.2945 },
        ],
      },
    ],
    hotels: [
      {
        name: "Hotel",
        geoCoordinates: { latitude: 48.86, longitude: 2.33 },
      },
    ],
    restaurants: [
      {
        name: "Cafe",
        geoCoordinates: { latitude: 48.8867, longitude: 2.3431 },
      },
    ],
  });

  assert.equal(points.length, 3);
  assert.equal(points[0].label, "A");
});
