import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTripDayPlans,
  summarizeTripDayPlans,
} from "../src/lib/tripDayPlan.js";

test("buildTripDayPlans merges structured days with itinerary places and computes route legs", () => {
  const dayPlans = buildTripDayPlans({
    userSelection: {
      location: { label: "Tokyo, Japan" },
    },
    aiPlan: {
      destination: "Tokyo, Japan",
      days: [
        {
          dayNumber: 1,
          title: "Tokyo arrival",
          activities: ["Visit Senso-ji", "Walk through Asakusa"],
          estimatedCost: "$120",
          tips: "Carry transit cash for smaller kiosks.",
        },
      ],
    },
    itinerary: {
      days: [
        {
          dayNumber: 1,
          title: "Day 1",
          places: [
            {
              placeName: "Senso-ji",
              location: "Asakusa, Tokyo",
              geoCoordinates: { latitude: 35.7148, longitude: 139.7967 },
            },
            {
              placeName: "Tokyo Skytree",
              location: "Sumida, Tokyo",
              geoCoordinates: { latitude: 35.7101, longitude: 139.8107 },
            },
            {
              placeName: "Ueno Park",
              location: "Ueno, Tokyo",
              geoCoordinates: { latitude: 35.7156, longitude: 139.7745 },
            },
          ],
        },
      ],
    },
  });

  assert.equal(dayPlans.length, 1);
  assert.equal(dayPlans[0].title, "Tokyo arrival");
  assert.equal(dayPlans[0].activities.length, 2);
  assert.equal(dayPlans[0].places.length, 3);
  assert.equal(dayPlans[0].legDistances.length, 2);
  assert.ok(dayPlans[0].totalDistanceMeters > 0);
  assert.equal(dayPlans[0].legDistances[0].distanceLabel.endsWith("km"), true);
});

test("buildTripDayPlans falls back to itinerary-only days when ai plan days are unavailable", () => {
  const dayPlans = buildTripDayPlans({
    userSelection: {
      location: { label: "Dubai, United Arab Emirates" },
    },
    itinerary: {
      days: [
        {
          dayNumber: 1,
          title: "Old Dubai",
          places: [
            {
              placeName: "Al Fahidi Historical District",
              location: "Dubai",
            },
          ],
        },
      ],
    },
  });

  assert.equal(dayPlans.length, 1);
  assert.equal(dayPlans[0].title, "Old Dubai");
  assert.equal(dayPlans[0].activities.length, 0);
  assert.equal(dayPlans[0].places.length, 1);
  assert.equal(dayPlans[0].legDistances.length, 0);
});

test("summarizeTripDayPlans aggregates day counts, places, and algorithm distances", () => {
  const summary = summarizeTripDayPlans([
    {
      activities: ["A", "B"],
      places: [{ isResolved: true }, { isResolved: false }],
      totalDistanceMeters: 2400,
    },
    {
      activities: ["C"],
      places: [{ isResolved: true }],
      totalDistanceMeters: 3600,
    },
  ]);

  assert.deepEqual(summary, {
    totalDays: 2,
    totalActivities: 3,
    totalPlaces: 3,
    totalResolvedPlaces: 2,
    totalDistanceMeters: 6000,
  });
});
