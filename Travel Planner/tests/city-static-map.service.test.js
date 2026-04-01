import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryCacheStore } from "../server/services/cacheStore.js";
import {
  buildOverpassBasemapQuery,
  buildOverpassBoundaryQuery,
  buildFallbackOutlineFromBounds,
  getStaticCityBasemap,
} from "../server/services/cityStaticMap.js";

test("buildOverpassBasemapQuery scopes the query to the requested city bounds", () => {
  const query = buildOverpassBasemapQuery({
    north: 35.82,
    south: 35.55,
    east: 139.92,
    west: 139.55,
  });

  assert.equal(query.includes("35.55,139.55,35.82,139.92"), true);
  assert.equal(query.includes("highway"), true);
  assert.equal(query.includes("leisure"), true);
});

test("buildOverpassBoundaryQuery targets the named destination outline inside the city bounds", () => {
  const query = buildOverpassBoundaryQuery("Tokyo, Japan", {
    north: 35.82,
    south: 35.55,
    east: 139.92,
    west: 139.55,
  });

  assert.equal(query.includes("Tokyo"), true);
  assert.equal(query.includes("boundary"), true);
  assert.equal(query.includes("35.55,139.55,35.82,139.92"), true);
});

test("buildFallbackOutlineFromBounds returns a simplified destination shell", () => {
  const outline = buildFallbackOutlineFromBounds({
    north: 35.82,
    south: 35.55,
    east: 139.92,
    west: 139.55,
  });

  assert.equal(outline.source, "fallback_bounds");
  assert.equal(outline.polygons.length, 1);
  assert.equal(outline.polygons[0].length >= 8, true);
});

test("getStaticCityBasemap parses OSM-style features and reuses the cache", async () => {
  let fetchCount = 0;
  const cacheStore = createMemoryCacheStore();
  const bounds = {
    north: 35.82,
    south: 35.55,
    east: 139.92,
    west: 139.55,
  };

  const fetchImpl = async (_url, options = {}) => {
    fetchCount += 1;
    const body = String(options.body ?? "");

    return {
      ok: true,
      async json() {
        if (body.includes("highway")) {
          return {
            elements: [
              {
                type: "way",
                id: 1,
                tags: { highway: "primary" },
                geometry: [
                  { lat: 35.67, lon: 139.68 },
                  { lat: 35.68, lon: 139.7 },
                  { lat: 35.69, lon: 139.73 },
                ],
              },
              {
                type: "way",
                id: 2,
                tags: { natural: "water" },
                geometry: [
                  { lat: 35.66, lon: 139.75 },
                  { lat: 35.67, lon: 139.77 },
                  { lat: 35.65, lon: 139.78 },
                  { lat: 35.66, lon: 139.75 },
                ],
              },
              {
                type: "way",
                id: 3,
                tags: { leisure: "park" },
                geometry: [
                  { lat: 35.7, lon: 139.64 },
                  { lat: 35.71, lon: 139.65 },
                  { lat: 35.7, lon: 139.66 },
                  { lat: 35.7, lon: 139.64 },
                ],
              },
            ],
          };
        }

        return {
          elements: [
            {
              type: "relation",
              id: 99,
              tags: {
                boundary: "administrative",
                name: "Tokyo",
                admin_level: "8",
              },
              members: [
                {
                  role: "outer",
                  geometry: [
                    { lat: 35.57, lon: 139.58 },
                    { lat: 35.80, lon: 139.60 },
                    { lat: 35.79, lon: 139.90 },
                    { lat: 35.60, lon: 139.89 },
                    { lat: 35.57, lon: 139.58 },
                  ],
                },
              ],
            },
          ],
        };
      },
    };
  };

  const basemap = await getStaticCityBasemap({
    destination: "Tokyo, Japan",
    cityBounds: bounds,
    fetchImpl,
    cacheStore,
  });
  const cachedBasemap = await getStaticCityBasemap({
    destination: "Tokyo, Japan",
    cityBounds: bounds,
    fetchImpl,
    cacheStore,
  });

  assert.equal(fetchCount, 2);
  assert.equal(basemap.roads.length, 1);
  assert.equal(basemap.water.length, 1);
  assert.equal(basemap.parks.length, 1);
  assert.equal(basemap.outline?.source, "administrative_boundary");
  assert.equal(basemap.outline?.polygons?.length, 1);
  assert.equal(cachedBasemap.roads[0].id, basemap.roads[0].id);
});
