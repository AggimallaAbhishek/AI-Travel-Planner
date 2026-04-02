import test from "node:test";
import assert from "node:assert/strict";
import { buildCompleteTransportEdges } from "../server/services/geo.js";

test("buildCompleteTransportEdges keeps weight aligned to durationSeconds", () => {
  const places = [
    {
      id: "a",
      coordinates: { latitude: 12.9, longitude: 77.5 },
    },
    {
      id: "b",
      coordinates: { latitude: 12.91, longitude: 77.52 },
    },
  ];

  const edges = buildCompleteTransportEdges(places, {
    mode: "drive",
    source: "haversine_fallback",
  });

  assert.equal(edges.length, 2);
  for (const edge of edges) {
    assert.equal(Number.isFinite(edge.durationSeconds), true);
    assert.equal(edge.weight, edge.durationSeconds);
  }
});
