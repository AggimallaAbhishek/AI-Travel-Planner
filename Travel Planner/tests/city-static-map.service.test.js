import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryCacheStore } from "../server/services/cacheStore.js";
import {
  buildOverpassBasemapQuery,
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

test("getStaticCityBasemap parses OSM-style features and reuses the cache", async () => {
  let fetchCount = 0;
  const cacheStore = createMemoryCacheStore();
  const bounds = {
    north: 35.82,
    south: 35.55,
    east: 139.92,
    west: 139.55,
  };

  const fetchImpl = async () => {
    fetchCount += 1;

    return {
      ok: true,
      async json() {
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

  assert.equal(fetchCount, 1);
  assert.equal(basemap.roads.length, 1);
  assert.equal(basemap.water.length, 1);
  assert.equal(basemap.parks.length, 1);
  assert.equal(cachedBasemap.roads[0].id, basemap.roads[0].id);
});
