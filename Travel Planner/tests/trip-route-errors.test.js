import test from "node:test";
import assert from "node:assert/strict";
import { resolveTripGenerationFailure } from "../server/routes/trips.js";

test("resolveTripGenerationFailure maps missing Firestore setup errors", () => {
  const failure = resolveTripGenerationFailure(
    new Error("Cloud Firestore API has not been used in project yet.")
  );

  assert.match(failure.message, /Create\/enable Firestore/i);
  assert.match(failure.hint, /Firestore Database -> Create database/i);
});

test("resolveTripGenerationFailure maps classified Firestore database-not-found errors", () => {
  const error = new Error(
    "Firestore database was not found for project ai-travel-planner-b805a. Create Firestore in Native mode."
  );
  error.code = "firestore/database-not-found";

  const failure = resolveTripGenerationFailure(error);

  assert.match(failure.message, /Create\/enable Firestore/i);
  assert.match(failure.hint, /verify FIREBASE_PROJECT_ID/i);
});

test("resolveTripGenerationFailure maps Firestore permission errors", () => {
  const failure = resolveTripGenerationFailure(
    new Error("7 PERMISSION_DENIED: Missing or insufficient permissions.")
  );

  assert.match(failure.message, /Firestore permissions/i);
  assert.match(failure.hint, /Cloud Datastore User/i);
});

test("resolveTripGenerationFailure maps Gemini network fetch failures", () => {
  const failure = resolveTripGenerationFailure(
    new Error(
      "[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent: fetch failed"
    )
  );

  assert.match(failure.message, /service is currently unreachable/i);
  assert.match(failure.hint, /outbound network access/i);
});

test("resolveTripGenerationFailure maps Firestore timeout failures", () => {
  const error = new Error("Firestore trip write timed out after 12000ms.");
  error.code = "firestore/timeout";
  const failure = resolveTripGenerationFailure(error);

  assert.match(failure.message, /trip store timed out/i);
  assert.match(failure.hint, /FIRESTORE_OPERATION_TIMEOUT_MS/i);
});

test("resolveTripGenerationFailure keeps generic guidance for unknown errors", () => {
  const failure = resolveTripGenerationFailure(new Error("Unknown failure"));

  assert.equal(failure.message, "Unable to generate a trip right now.");
  assert.match(failure.hint, /Check server logs/i);
});
