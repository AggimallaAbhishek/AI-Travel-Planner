import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveDependentServiceFailure,
  resolveTripGenerationFailure,
} from "../server/routes/trips.js";

test("resolveTripGenerationFailure maps missing Firestore setup errors", () => {
  const failure = resolveTripGenerationFailure(
    new Error("Cloud Firestore API has not been used in project yet.")
  );

  assert.equal(failure.status, 500);
  assert.match(failure.message, /Create\/enable Firestore/i);
  assert.match(failure.hint, /Firestore Database -> Create database/i);
});

test("resolveTripGenerationFailure maps classified Firestore database-not-found errors", () => {
  const error = new Error(
    "Firestore database was not found for project ai-travel-planner-b805a. Create Firestore in Native mode."
  );
  error.code = "firestore/database-not-found";

  const failure = resolveTripGenerationFailure(error);

  assert.equal(failure.status, 500);
  assert.match(failure.message, /Create\/enable Firestore/i);
  assert.match(failure.hint, /verify FIREBASE_PROJECT_ID/i);
});

test("resolveTripGenerationFailure maps Firestore permission errors", () => {
  const failure = resolveTripGenerationFailure(
    new Error("7 PERMISSION_DENIED: Missing or insufficient permissions.")
  );

  assert.equal(failure.status, 500);
  assert.match(failure.message, /Firestore permissions/i);
  assert.match(failure.hint, /Cloud Datastore User/i);
});

test("resolveTripGenerationFailure maps Gemini network fetch failures", () => {
  const failure = resolveTripGenerationFailure(
    new Error(
      "[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent: fetch failed"
    )
  );

  assert.equal(failure.status, 503);
  assert.match(failure.message, /service is currently unreachable/i);
  assert.match(failure.hint, /outbound network access/i);
});

test("resolveTripGenerationFailure maps Gemini timeout failures to HTTP 504", () => {
  const failure = resolveTripGenerationFailure(
    new Error("Gemini upstream request timed out after 20000ms")
  );

  assert.equal(failure.status, 504);
  assert.match(failure.message, /service is currently unreachable/i);
});

test("resolveTripGenerationFailure keeps generic guidance for unknown errors", () => {
  const failure = resolveTripGenerationFailure(new Error("Unknown failure"));

  assert.equal(failure.status, 500);
  assert.equal(failure.message, "Unable to generate a trip right now.");
  assert.match(failure.hint, /Check server logs/i);
});

test("resolveDependentServiceFailure maps timeout-like route failures to HTTP 504", () => {
  const failure = resolveDependentServiceFailure(
    new Error("Upstream request timed out while loading route data."),
    {
      fallbackMessage: "Unable to load optimized routes right now.",
      timeoutMessage: "Optimized routes timed out while contacting route providers. Please try again.",
    }
  );

  assert.equal(failure.status, 504);
  assert.match(failure.message, /timed out/i);
});

test("resolveDependentServiceFailure maps upstream provider outages to HTTP 503", () => {
  const failure = resolveDependentServiceFailure(
    new Error("fetch failed while contacting Google Places provider"),
    {
      fallbackMessage: "Unable to load the trip map right now.",
      providerMessage:
        "The trip map is temporarily unavailable because a routing or place provider could not respond.",
    }
  );

  assert.equal(failure.status, 503);
  assert.match(failure.message, /temporarily unavailable/i);
});
