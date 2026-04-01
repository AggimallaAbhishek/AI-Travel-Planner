import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPersistableTripForFirestore,
  resolveTripPersistenceFailure,
} from "../server/services/trips.js";

test("resolveTripPersistenceFailure maps raw Firestore NOT_FOUND errors to database guidance", () => {
  const failure = resolveTripPersistenceFailure({
    code: 5,
    message: "5 NOT_FOUND: The database (default) does not exist for project ai-travel-planner-b805a.",
  });

  assert.equal(failure.code, "firestore/database-not-found");
  assert.match(failure.message, /Firestore database was not found/i);
  assert.match(failure.message, /Create Firestore in Native mode/i);
});

test("resolveTripPersistenceFailure preserves unrelated errors", () => {
  const error = new Error("Some other failure");
  const resolved = resolveTripPersistenceFailure(error);

  assert.equal(resolved, error);
});

test("resolveTripPersistenceFailure maps oversized document errors", () => {
  const failure = resolveTripPersistenceFailure({
    code: "resource-exhausted",
    message: "8 RESOURCE_EXHAUSTED: Document exceeds the maximum allowed size.",
  });

  assert.equal(failure.code, "firestore/document-too-large");
  assert.match(failure.message, /document size limit/i);
});

test("buildPersistableTripForFirestore trims oversized llm artifacts", () => {
  const payload = buildPersistableTripForFirestore({
    id: "trip-1",
    llmArtifacts: {
      planner_output: "x".repeat(900_000),
      critic_report: {
        valid: true,
        notes: "y".repeat(10_000),
      },
    },
    routeAlternatives: [
      {
        id: "alt-1",
        polyline: "z".repeat(50_000),
      },
    ],
  });

  assert.equal(payload.trip.routeAlternatives.length <= 1, true);
  assert.ok(payload.sizeBytes < 850_000);
  assert.equal(typeof payload.trip.llmArtifacts?.planner_output, "string");
  assert.ok(payload.trip.llmArtifacts.planner_output.length < 20_000);
});
