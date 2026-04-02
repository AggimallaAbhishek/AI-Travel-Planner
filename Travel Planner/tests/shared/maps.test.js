import test from "node:test";
import assert from "node:assert/strict";
import { resolveGoogleMapsUrl } from "../../shared/maps.js";

test("resolveGoogleMapsUrl prioritizes query_place_id for exact place links", () => {
  const mapsUrl = resolveGoogleMapsUrl({
    name: "Gateway of India",
    address: "Mumbai, India",
    placeId: "ChIJ0TOKA9fP5zsRj4SEfR7A6iI",
    coordinates: {
      latitude: 18.922,
      longitude: 72.8347,
    },
  });

  assert.match(mapsUrl, /google\.com\/maps\/search\/\?api=1/);
  assert.match(mapsUrl, /query_place_id=ChIJ0TOKA9fP5zsRj4SEfR7A6iI/);
});

test("resolveGoogleMapsUrl ignores mock place ids and falls back to coordinates", () => {
  const mapsUrl = resolveGoogleMapsUrl({
    name: "Mock Stop",
    externalPlaceId: "mock-attraction-mumbai-1",
    coordinates: {
      latitude: 19.076,
      longitude: 72.8777,
    },
  });

  assert.match(mapsUrl, /query=19\.076,72\.8777/);
  assert.doesNotMatch(mapsUrl, /query_place_id=/);
});

test("resolveGoogleMapsUrl falls back to the provided mapsUrl when place id and coordinates are unavailable", () => {
  const mapsUrl = resolveGoogleMapsUrl({
    mapsUrl: "https://www.google.com/maps/place/India+Gate/",
    name: "India Gate",
  });

  assert.equal(mapsUrl, "https://www.google.com/maps/place/India+Gate/");
});

