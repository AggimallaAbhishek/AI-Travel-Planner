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

test("buildCreateTripQuery derives days and budget tier from planner payload", () => {
  const query = buildCreateTripQuery({
    destination: "Kyoto, Japan",
    fromDate: "2026-04-01",
    toDate: "2026-04-05",
    budgetAmount: 3200,
    travelers: "3-5 Travelers",
  });

  const params = new URLSearchParams(query);

  assert.equal(params.get("destination"), "Kyoto, Japan");
  assert.equal(params.get("days"), "5");
  assert.equal(params.get("budget"), "Moderate");
  assert.equal(params.get("travelers"), "Family");
});

test("readCreateTripPrefill parses create-trip query into canonical selection fields", () => {
  const prefill = readCreateTripPrefill(
    "?destination=Rome%2C%20Italy&days=6&budget=Luxury&travelers=2%20Travelers"
  );

  assert.deepEqual(prefill, {
    location: { label: "Rome, Italy" },
    days: 6,
    budget: "Luxury",
    travelers: "A Couple",
  });
});

test("readCreateTripPrefill leaves days null when not explicitly provided", () => {
  const prefill = readCreateTripPrefill("?destination=Paris");

  assert.deepEqual(prefill, {
    location: { label: "Paris" },
    days: null,
    budget: null,
    travelers: null,
  });
});
