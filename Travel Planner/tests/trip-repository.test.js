import test from "node:test";
import assert from "node:assert/strict";
import {
  createTripRepository,
  resolveTripPersistenceDriver,
} from "../server/repositories/tripRepository.js";

test("resolveTripPersistenceDriver defaults to firestore when no database url exists", () => {
  assert.equal(resolveTripPersistenceDriver({}), "firestore");
});

test("resolveTripPersistenceDriver prefers postgres when database url exists", () => {
  assert.equal(
    resolveTripPersistenceDriver({
      DATABASE_URL: "postgres://user:pass@localhost:5432/travel_planner",
    }),
    "postgres"
  );
});

test("resolveTripPersistenceDriver honors explicit firestore override", () => {
  assert.equal(
    resolveTripPersistenceDriver({
      DATABASE_URL: "postgres://user:pass@localhost:5432/travel_planner",
      TRIP_PERSISTENCE_BACKEND: "firestore",
    }),
    "firestore"
  );
});

test("createTripRepository returns a postgres repository when configured", () => {
  const repository = createTripRepository({
    DATABASE_URL: "postgres://user:pass@localhost:5432/travel_planner",
  });

  assert.equal(repository.driver, "postgres");
});
