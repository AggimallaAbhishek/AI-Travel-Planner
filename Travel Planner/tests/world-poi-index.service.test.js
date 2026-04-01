import test from "node:test";
import assert from "node:assert/strict";
import {
  clearWorldPoiIndexCacheForTests,
  listDestinationPois,
  resolvePlace,
  resolvePlacesForDay,
} from "../server/services/worldPoiIndex.js";

test.beforeEach(() => {
  clearWorldPoiIndexCacheForTests();
});

test("world poi index resolves exact destination-scoped place matches", async () => {
  const match = await resolvePlace({
    destination: "Kyoto, Japan",
    query: "Fushimi Inari Shrine",
  });

  assert.equal(match?.name, "Fushimi Inari Shrine");
  assert.equal(match?.provider, "world_poi_index");
  assert.equal(match?.matchType, "exact");
});

test("world poi index resolves aliases and fuzzy queries", async () => {
  const aliasMatch = await resolvePlace({
    destination: "Petra, Jordan",
    query: "The Treasury",
  });
  const fuzzyMatch = await resolvePlace({
    destination: "Sydney, Australia",
    query: "Sydney Harbour",
  });

  assert.equal(aliasMatch?.name, "Al-Khazneh");
  assert.equal(aliasMatch?.matchType, "exact");
  assert.equal(fuzzyMatch?.name, "Sydney Harbour Bridge");
  assert.equal(["alias", "fuzzy", "exact"].includes(fuzzyMatch?.matchType), true);
});

test("world poi index resolves day text into unique mapped places", async () => {
  const matches = await resolvePlacesForDay({
    destination: "Bali, Indonesia",
    texts: [
      "Visit the majestic Uluwatu Temple, perched on a cliff overlooking the Indian Ocean.",
      "Spend some time at Padang Padang Beach or Bingin Beach, known for their beauty.",
    ],
  });

  assert.deepEqual(
    matches.slice(0, 2).map((match) => match.name),
    ["Uluwatu Temple", "Padang Padang Beach"]
  );
});

test("world poi index lists top destination attractions and respects category filters", async () => {
  const allPois = await listDestinationPois({
    destination: "Dubai, United Arab Emirates",
    limit: 4,
  });
  const waterfrontPois = await listDestinationPois({
    destination: "Dubai, United Arab Emirates",
    limit: 4,
    categories: ["waterfront"],
  });

  assert.equal(allPois[0]?.name, "Burj Khalifa");
  assert.equal(waterfrontPois.every((poi) => poi.categories.includes("waterfront")), true);
});

test("world poi index exposes transport and hospitality categories for supported destinations", async () => {
  const airportPois = await listDestinationPois({
    destination: "Tokyo, Japan",
    limit: 3,
    categories: ["airport"],
  });
  const hotelPois = await listDestinationPois({
    destination: "Tokyo, Japan",
    limit: 3,
    categories: ["hotel"],
  });
  const railPois = await listDestinationPois({
    destination: "Tokyo, Japan",
    limit: 3,
    categories: ["rail_station", "metro_station"],
  });

  assert.equal(airportPois.some((poi) => poi.name === "Haneda Airport"), true);
  assert.equal(hotelPois.some((poi) => poi.categories.includes("hotel")), true);
  assert.equal(
    railPois.some((poi) =>
      poi.categories.some((category) => ["rail_station", "metro_station"].includes(category))
    ),
    true
  );
});

test("world poi index returns null when a destination-scoped match does not exist", async () => {
  const match = await resolvePlace({
    destination: "Rome, Italy",
    query: "Mystery Hidden Spot",
  });

  assert.equal(match, null);
});
