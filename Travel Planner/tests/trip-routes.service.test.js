import test from "node:test";
import assert from "node:assert/strict";
import { resolveRequestedRouteDay } from "../server/services/tripRoutes.js";

test("resolveRequestedRouteDay clamps to fallback when invalid", () => {
  assert.equal(resolveRequestedRouteDay("0", 2, 5), 1);
  assert.equal(resolveRequestedRouteDay("8", 2, 5), 5);
  assert.equal(resolveRequestedRouteDay("abc", 2, 5), 2);
  assert.equal(resolveRequestedRouteDay(undefined, 2, 5), 2);
});

test("resolveRequestedRouteDay keeps valid values", () => {
  assert.equal(resolveRequestedRouteDay("3", 1, 5), 3);
  assert.equal(resolveRequestedRouteDay(4, 1, 5), 4);
});

