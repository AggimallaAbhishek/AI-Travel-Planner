import test from "node:test";
import assert from "node:assert/strict";
import { isTripAccessibleByUser } from "../server/services/trips.js";

const SAMPLE_TRIP = {
  id: "trip-1",
  ownerId: "owner-uid",
  ownerEmail: "owner@example.com",
};

test("isTripAccessibleByUser allows admin access across users", () => {
  const adminUser = {
    uid: "admin-uid",
    email: "aggimallaabhishek@gmail.com",
    role: "admin",
    isAdmin: true,
  };

  assert.equal(isTripAccessibleByUser(SAMPLE_TRIP, adminUser), true);
});

test("isTripAccessibleByUser keeps non-admin ownership restrictions", () => {
  const ownerUser = {
    uid: "owner-uid",
    email: "owner@example.com",
    role: "user",
    isAdmin: false,
  };
  const anotherUser = {
    uid: "another-uid",
    email: "another@example.com",
    role: "user",
    isAdmin: false,
  };

  assert.equal(isTripAccessibleByUser(SAMPLE_TRIP, ownerUser), true);
  assert.equal(isTripAccessibleByUser(SAMPLE_TRIP, anotherUser), false);
});
