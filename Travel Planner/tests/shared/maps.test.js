import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGoogleMapsDirectionsUrl,
  buildGoogleMapsSearchUrl,
  decodeGooglePolyline,
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

test("buildGoogleMapsDirectionsUrl creates a directions link with waypoints", () => {
  const url = buildGoogleMapsDirectionsUrl({
    origin: {
      placeName: "Louvre Museum",
      destination: "Paris, France",
      coordinates: [2.3364, 48.8606],
    },
    destination: {
      placeName: "Eiffel Tower",
      destination: "Paris, France",
      coordinates: [2.2945, 48.8584],
    },
    waypoints: [
      {
        placeName: "Arc de Triomphe",
        destination: "Paris, France",
      },
    ],
  });

  const parsed = new URL(url);

  assert.equal(parsed.origin, "https://www.google.com");
  assert.equal(parsed.pathname, "/maps/dir/");
  assert.equal(parsed.searchParams.get("api"), "1");
  assert.equal(parsed.searchParams.get("origin"), "48.8606,2.3364");
  assert.equal(parsed.searchParams.get("destination"), "48.8584,2.2945");
  assert.equal(parsed.searchParams.get("travelmode"), "driving");
  assert.equal(
    parsed.searchParams.get("waypoints"),
    "Arc de Triomphe, Paris, France"
  );
});

test("decodeGooglePolyline decodes an encoded polyline into coordinates", () => {
  const points = decodeGooglePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");

  assert.deepEqual(points, [
    { latitude: 38.5, longitude: -120.2 },
    { latitude: 40.7, longitude: -120.95 },
    { latitude: 43.252, longitude: -126.453 },
  ]);
});
