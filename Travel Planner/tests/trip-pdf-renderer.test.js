import test from "node:test";
import assert from "node:assert/strict";
import { createTripPdfDocument } from "../src/lib/trip-pdf/renderer.js";

function buildLongTrip(dayCount = 8) {
  const days = Array.from({ length: dayCount }, (_, index) => ({
    day: index + 1,
    title: `Day ${index + 1} Highlights`,
    activities: [
      `Morning walk and orientation ${index + 1}`,
      `Landmark visit ${index + 1}`,
      `Local lunch ${index + 1}`,
      `Cultural activity ${index + 1}`,
      `Evening dinner ${index + 1}`,
    ],
    estimatedCost: `$${120 + index * 10}`,
    tips: `Keep transport buffer for day ${index + 1}.`,
  }));

  const itineraryDays = days.map((day, index) => ({
    dayNumber: day.day,
    title: day.title,
    places: [
      {
        placeName: `Stop ${index + 1}`,
        placeDetails: "Scenic and cultural stop.",
        geoCoordinates: {
          latitude: 41.9 + index * 0.01,
          longitude: 12.49 + index * 0.01,
        },
      },
    ],
  }));

  return {
    userSelection: {
      location: { label: "Rome" },
      budget: "Moderate",
      travelers: "Friends",
      travelType: "Explorer",
    },
    createdAt: "2026-01-01T08:00:00.000Z",
    aiPlan: {
      totalEstimatedCost: "$1,400 - $2,000",
      days,
      travelTips: [
        "Carry a refillable bottle.",
        "Prebook top attractions.",
      ],
    },
    itinerary: {
      days: itineraryDays,
    },
    hotels: [],
  };
}

test("createTripPdfDocument paginates long itineraries and falls back fonts safely", async () => {
  const trip = buildLongTrip(9);

  const result = await createTripPdfDocument({
    trip,
    recommendations: {},
    options: {
      disableImages: true,
      disableFontEmbedding: true,
    },
  });

  assert.equal(result.model.destination, "Rome");
  assert.equal(result.model.itinerary.days.length, 9);
  assert.equal(result.pageCount > 1, true);
  assert.equal(result.fonts.headingFamily, "helvetica");
  assert.equal(result.fonts.bodyFamily, "helvetica");
});
