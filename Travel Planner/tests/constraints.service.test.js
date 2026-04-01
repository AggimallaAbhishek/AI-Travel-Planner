import test from "node:test";
import assert from "node:assert/strict";
import {
  applyDeterministicTripRepairs,
  buildRepairDiff,
  evaluateTripConstraints,
} from "../server/services/constraints.js";

test("evaluateTripConstraints flags hard violations for day mismatch and budget overflow", () => {
  const report = evaluateTripConstraints({
    generatedTrip: {
      destination: "Rome",
      days: [
        {
          day: 1,
          title: "Arrival",
          activities: ["Check-in", "Old town walk"],
          estimated_cost: "$500-$700",
          tips: "Book early.",
        },
      ],
      total_estimated_cost: "$4200-$5200",
      travel_tips: ["Carry cash."],
    },
    userSelection: {
      location: { label: "Rome" },
      days: 3,
      budget: "Moderate",
      travelers: "Friends",
      objective: "best_experience",
      constraints: {
        dailyTimeLimitHours: 8,
        budgetCap: 2000,
        mobilityPref: "balanced",
        mealPrefs: [],
      },
      alternativesCount: 3,
    },
  });

  assert.equal(report.valid, false);
  assert.equal(
    report.hardViolations.some((violation) =>
      violation.includes("Expected 3 days but received 1")
    ),
    true
  );
  assert.equal(
    report.hardViolations.some((violation) =>
      violation.includes("exceeds budget cap")
    ),
    true
  );
});

test("applyDeterministicTripRepairs enforces day count and activity minimums", () => {
  const repaired = applyDeterministicTripRepairs({
    generatedTrip: {
      destination: "Tokyo",
      days: [
        {
          day: 1,
          title: "Arrival",
          activities: ["Check-in"],
          estimated_cost: "Not specified",
          tips: "",
        },
      ],
      total_estimated_cost: "$120-$220",
      travel_tips: ["Tip"],
    },
    userSelection: {
      location: { label: "Tokyo" },
      days: 2,
      budget: "Moderate",
      travelers: "Just Me",
      objective: "fastest",
      constraints: {
        dailyTimeLimitHours: 10,
        budgetCap: null,
        mobilityPref: "balanced",
        mealPrefs: [],
      },
      alternativesCount: 3,
    },
  });

  assert.equal(repaired.aiPlan.days.length, 2);
  assert.equal(repaired.aiPlan.days[0].activities.length >= 3, true);
  assert.equal(repaired.aiPlan.days[1].activities.length >= 3, true);
});

test("buildRepairDiff returns added and removed activities", () => {
  const diff = buildRepairDiff({
    beforeTrip: {
      destination: "Paris",
      days: [
        {
          day: 1,
          title: "Day 1",
          activities: ["Eiffel Tower", "Louvre Museum"],
          estimated_cost: "$100-$200",
          tips: "",
        },
      ],
      total_estimated_cost: "$100-$200",
      travel_tips: [],
    },
    afterTrip: {
      destination: "Paris",
      days: [
        {
          day: 1,
          title: "Day 1",
          activities: ["Louvre Museum", "Seine Cruise"],
          estimated_cost: "$100-$200",
          tips: "",
        },
      ],
      total_estimated_cost: "$100-$200",
      travel_tips: [],
    },
  });

  assert.equal(diff.changed, true);
  assert.equal(diff.removedActivities.includes("eiffel tower"), true);
  assert.equal(diff.addedActivities.includes("seine cruise"), true);
});
