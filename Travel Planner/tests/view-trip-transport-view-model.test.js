import test from "node:test";
import assert from "node:assert/strict";
import {
  formatDistanceKm,
  formatDurationMinutes,
  getDayPlaceCountMeta,
  normalizeTripTransportData,
  summarizePlaceCountCompliance,
} from "../src/view-trip/transportViewModel.js";

test("normalizeTripTransportData maps snake_case transport payloads", () => {
  const normalized = normalizeTripTransportData({
    transport_options: [
      {
        option_id: "option-1",
        mode: "flight",
        source_city: "Delhi",
        destination_city: "Jaipur",
        duration_minutes: 65,
        distance_km: 241,
        transfer_count: 0,
      },
    ],
    route_verification: {
      status: "verified",
      provider: "gemini",
      confidence: 0.91,
      notes: ["candidate ranked"],
    },
    transport_summary: {
      objective: "fastest_feasible",
      algorithm: "python-multimodal-dijkstra-v2",
      top_k: 4,
      max_transfers: 2,
      fallback_used: false,
    },
  });

  assert.equal(normalized.options.length, 1);
  assert.equal(normalized.options[0].mode, "flight");
  assert.equal(normalized.routeVerification.status, "verified");
  assert.equal(normalized.transportSummary.algorithm, "python-multimodal-dijkstra-v2");
});

test("getDayPlaceCountMeta resolves explicit and derived target compliance", () => {
  const explicit = getDayPlaceCountMeta({
    placeCount: 2,
    placeCountTargetMet: false,
  });
  assert.equal(explicit.placeCount, 2);
  assert.equal(explicit.placeCountTargetMet, false);

  const derived = getDayPlaceCountMeta({
    places: [{}, {}, {}],
  });
  assert.equal(derived.placeCount, 3);
  assert.equal(derived.placeCountTargetMet, true);
});

test("summarizePlaceCountCompliance reports met/unmet days", () => {
  const summary = summarizePlaceCountCompliance([
    { dayNumber: 1, placeCount: 3, placeCountTargetMet: true },
    { dayNumber: 2, places: [{}, {}] },
    { dayNumber: 3, places: [{}, {}, {}, {}] },
  ]);

  assert.equal(summary.totalDays, 3);
  assert.equal(summary.metDays, 2);
  assert.deepEqual(summary.unmetDays, [2]);
});

test("formatters produce stable display values", () => {
  assert.equal(formatDurationMinutes(130), "2h 10m");
  assert.equal(formatDurationMinutes(45), "45 min");
  assert.equal(formatDistanceKm(245.34), "245 km");
  assert.equal(formatDistanceKm(24.34), "24.3 km");
});
