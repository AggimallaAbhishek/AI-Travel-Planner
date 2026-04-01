import test from "node:test";
import assert from "node:assert/strict";
import { validateReplanRequest } from "../server/services/trips.js";

test("validateReplanRequest accepts valid disruption payload", () => {
  const result = validateReplanRequest({
    disruptions: [
      {
        type: "traffic_delay",
        dayNumber: 2,
        placeName: "Burj Khalifa",
      },
    ],
  });

  assert.equal(result.errors.length, 0);
  assert.equal(result.disruptions.length, 1);
  assert.equal(result.disruptions[0].type, "traffic_delay");
});

test("validateReplanRequest rejects empty disruption payload", () => {
  const result = validateReplanRequest({
    disruptions: [],
  });

  assert.equal(result.errors.includes("At least one disruption event is required."), true);
});
