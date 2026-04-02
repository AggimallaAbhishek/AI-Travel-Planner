import test from "node:test";
import assert from "node:assert/strict";
import { rebalanceDayPlansForTargetStops } from "../server/services/planningEngine.js";

test("rebalanceDayPlansForTargetStops keeps 3 to 4 stops per day when enough stops are available", () => {
  const dayPlans = rebalanceDayPlansForTargetStops({
    dayCount: 3,
    visitOrder: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  });

  assert.equal(dayPlans.length, 3);
  assert.deepEqual(dayPlans.map((day) => day.stopCount), [4, 3, 3]);
  assert.equal(dayPlans.every((day) => day.stopCount >= 3 && day.stopCount <= 4), true);
});

test("rebalanceDayPlansForTargetStops falls back to even distribution when stops are insufficient", () => {
  const dayPlans = rebalanceDayPlansForTargetStops({
    dayCount: 3,
    visitOrder: [0, 1, 2, 3, 4, 5],
  });

  assert.equal(dayPlans.length, 3);
  assert.deepEqual(dayPlans.map((day) => day.stopCount), [2, 2, 2]);
});

test("rebalanceDayPlansForTargetStops caps day plans at four stops and drops overflow", () => {
  const dayPlans = rebalanceDayPlansForTargetStops({
    dayCount: 2,
    visitOrder: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  });

  assert.equal(dayPlans.length, 2);
  assert.equal(dayPlans.every((day) => day.stopCount <= 4), true);
  assert.equal(dayPlans.reduce((total, day) => total + day.stopCount, 0), 8);
});
