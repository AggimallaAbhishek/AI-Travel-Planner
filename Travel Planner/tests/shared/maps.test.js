import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGoogleMapsSearchUrl,
  normalizeGeoCoordinates,
  resolveGoogleMapsUrl,
} from "../../shared/maps.js";

test("normalizeGeoCoordinates supports Amazon-style [longitude, latitude] arrays", () => {
  assert.deepEqual(normalizeGeoCoordinates([2.2945, 48.8584]), {
    latitude: 48.8584,
    longitude: 2.2945,
  });
});

test("buildGoogleMapsSearchUrl prefers exact coordinates when available", () => {
  const url = buildGoogleMapsSearchUrl({
    name: "Eiffel Tower",
    destination: "Paris, France",
    coordinates: [2.2945, 48.8584],
  });

  assert.equal(
    url,
    "https://www.google.com/maps/search/?api=1&query=48.8584%2C2.2945"
  );
});

test("buildGoogleMapsSearchUrl falls back to a distinct text query", () => {
  const url = buildGoogleMapsSearchUrl({
    name: "Eiffel Tower",
    location: "Paris, France",
    destination: "Paris, France",
  });

  assert.equal(
    url,
    "https://www.google.com/maps/search/?api=1&query=Eiffel%20Tower%2C%20Paris%2C%20France"
  );
});

test("resolveGoogleMapsUrl keeps trusted Google Maps links", () => {
  const url = resolveGoogleMapsUrl({
    mapsUrl: "https://www.google.com/maps/place/Eiffel+Tower",
    name: "Eiffel Tower",
    destination: "Paris, France",
  });

  assert.equal(url, "https://www.google.com/maps/place/Eiffel+Tower");
});

test("resolveGoogleMapsUrl rejects non-Google map links and falls back safely", () => {
  const url = resolveGoogleMapsUrl({
    mapsUrl: "https://example.com/maps/eiffel-tower",
    name: "Eiffel Tower",
    destination: "Paris, France",
  });

  assert.equal(
    url,
    "https://www.google.com/maps/search/?api=1&query=Eiffel%20Tower%2C%20Paris%2C%20France"
  );
});
