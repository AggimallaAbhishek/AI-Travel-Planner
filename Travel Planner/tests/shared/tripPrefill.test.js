import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCreateTripQuery,
  normalizeTravelersLabel,
  readCreateTripPrefill,
} from "../../shared/tripPrefill.js";

test("normalizeTravelersLabel maps common user labels", () => {
  assert.equal(normalizeTravelersLabel("2 Travelers"), "A Couple");
  assert.equal(normalizeTravelersLabel("family"), "Family");
  assert.equal(normalizeTravelersLabel("6+"), "Friends");
});

test("buildCreateTripQuery derives days, numeric budget, and smart fields", () => {
  const query = buildCreateTripQuery({
    destination: "Kyoto, Japan",
    fromDate: "2026-04-01",
    toDate: "2026-04-05",
    budgetAmount: 3200,
    travelers: "3-5 Travelers",
    travelStyle: "Cultural",
    pace: "Balanced",
    foodPreferences: ["Vegetarian", "Vegan"],
  });

  const params = new URLSearchParams(query);

  assert.equal(params.get("destination"), "Kyoto, Japan");
  assert.equal(params.get("days"), "5");
  assert.equal(params.get("budget"), "3200");
  assert.equal(params.get("plan_type"), "Best Plan");
  assert.equal(params.get("travelers"), "Family");
  assert.equal(params.get("travel_style"), "Cultural");
  assert.equal(params.get("pace"), "Balanced");
  assert.equal(params.get("food_preference"), "Vegetarian,Vegan");
});

test("readCreateTripPrefill parses create-trip query into canonical selection fields", () => {
  const prefill = readCreateTripPrefill(
    "?destination=Rome%2C%20Italy&days=6&budget=4200&plan_type=Best%20Plan&travelers=2%20Travelers&travel_style=Cultural&pace=Relaxed&food_preference=Vegetarian,Vegan"
  );

  assert.deepEqual(prefill, {
    location: {
      label: "Rome, Italy",
      placeId: "",
      source: "",
      primaryText: "",
      secondaryText: "",
    },
    days: 6,
    budgetAmount: 4200,
    planType: "Best Plan",
    travelers: "A Couple",
    travelStyle: "Cultural",
    pace: "Relaxed",
    foodPreferences: ["Vegetarian", "Vegan"],
  });
});

test("readCreateTripPrefill leaves fields null when not explicitly provided", () => {
  const prefill = readCreateTripPrefill("?destination=Paris");

  assert.deepEqual(prefill, {
    location: {
      label: "Paris",
      placeId: "",
      source: "",
      primaryText: "",
      secondaryText: "",
    },
    days: null,
    budgetAmount: null,
    planType: null,
    travelers: null,
    travelStyle: null,
    pace: null,
    foodPreferences: [],
  });
});
