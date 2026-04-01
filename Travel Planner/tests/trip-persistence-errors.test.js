import test from "node:test";
import assert from "node:assert/strict";
import { resolveTripPersistenceFailure } from "../server/services/trips.js";

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
