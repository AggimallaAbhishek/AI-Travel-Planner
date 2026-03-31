import test from "node:test";
import assert from "node:assert/strict";
import {
  getUserSelectionErrors,
  normalizeGeneratedTrip,
  normalizeStoredTrip,
} from "../shared/trips.js";

test("normalizeGeneratedTrip parses fenced JSON and returns normalized days", () => {
  const trip = normalizeGeneratedTrip(`\`\`\`json
  {
    "hotels": [
      {
        "hotelName": "Central Stay",
        "hotelAddress": "1 Main Street",
        "price": { "range": "$120/night" },
        "hotelImageUrl": "https://images.example.com/hotel.jpg",
        "rating": 4.5
      }
    ],
    "itinerary": {
      "days": [
        {
          "dayNumber": 1,
          "title": "Arrival",
          "places": [
            {
              "placeName": "Louvre Museum",
              "placeDetails": "Spend the afternoon at the museum.",
              "travelTime": "20 minutes"
            }
          ]
        }
      ]
    }
  }
  \`\`\``);

  assert.equal(trip.hotels[0].hotelName, "Central Stay");
  assert.equal(trip.hotels[0].price, "$120/night");
  assert.equal(trip.itinerary.days.length, 1);
  assert.equal(trip.itinerary.days[0].places[0].placeName, "Louvre Museum");
  assert.equal(trip.aiPlan.days.length, 1);
});

test("normalizeStoredTrip upgrades legacy trip documents", () => {
  const trip = normalizeStoredTrip({
    id: "legacy-trip",
    userEmail: "owner@example.com",
    createdAt: "2026-03-31T10:00:00.000Z",
    userSelection: {
      location: { label: "Paris" },
      noOfDays: "3",
      budget: "Moderate",
      travelWith: "A Couple",
    },
    tripData: {
      hotels: [],
      itinerary: {
        day1: [
          {
            name: "Eiffel Tower",
            details: "Visit the tower in the evening.",
            ticketPrice: "€20",
          },
        ],
      },
    },
  });

  assert.equal(trip.id, "legacy-trip");
  assert.equal(trip.ownerEmail, "owner@example.com");
  assert.equal(trip.userSelection.days, 3);
  assert.equal(trip.userSelection.travelers, "A Couple");
  assert.equal(trip.itinerary.days[0].places[0].placeName, "Eiffel Tower");
  assert.equal(trip.aiPlan.days[0].day, 1);
});

test("getUserSelectionErrors flags incomplete requests", () => {
  assert.deepEqual(
    getUserSelectionErrors({
      days: 0,
      budget: "",
      travelers: "",
    }),
    [
      "Destination is required.",
      "Trip duration must be between 1 and 30 days.",
      "Budget is required.",
      "Traveler type is required.",
    ]
  );
});

test("getUserSelectionErrors enforces maximum text lengths", () => {
  const errors = getUserSelectionErrors({
    location: { label: "P".repeat(121) },
    days: 4,
    budget: "B".repeat(41),
    travelers: "T".repeat(41),
  });

  assert.deepEqual(errors, [
    "Destination must be 120 characters or fewer.",
    "Budget must be 40 characters or fewer.",
    "Traveler type must be 40 characters or fewer.",
  ]);
});

test("getUserSelectionErrors validates traveler count bounds when provided", () => {
  const errors = getUserSelectionErrors({
    location: { label: "Delhi" },
    days: 4,
    budget: "Moderate",
    travelers: "Friends",
    travelerCount: 51,
  });

  assert.ok(errors.includes("Traveler count must be between 1 and 50."));
});
