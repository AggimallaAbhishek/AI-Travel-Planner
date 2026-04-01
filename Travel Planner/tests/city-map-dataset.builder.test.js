import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCityMapArtifactPayload,
  deriveBoundsFromPolygons,
  filterOutlinePolygonsForReferenceBounds,
} from "../scripts/buildCityMapDataset.mjs";

test("buildCityMapArtifactPayload creates a manifest and destination lookup index", () => {
  const payload = buildCityMapArtifactPayload([
    {
      destinationKey: "bali__id",
      destinationLabel: "Bali, Indonesia",
      artifactFile: "artifacts/001-bali-id.json.gz",
      destination: {
        locality: "Bali",
        adminArea: "",
        countryCode: "ID",
        countryName: "Indonesia",
      },
      basemap: {
        mapSource: "prebuilt_city_map",
        outline: { source: "administrative_boundary" },
      },
    },
    {
      destinationKey: "tokyo__jp",
      destinationLabel: "Tokyo, Japan",
      artifactFile: "artifacts/002-tokyo-jp.json.gz",
      destination: {
        locality: "Tokyo",
        adminArea: "",
        countryCode: "JP",
        countryName: "Japan",
      },
      basemap: {
        mapSource: "prebuilt_city_map",
        outline: { source: "administrative_boundary" },
      },
    },
  ]);

  assert.equal(payload.manifest.destinationCount, 2);
  assert.equal(payload.manifest.artifactMap.length, 2);
  assert.equal(payload.destinationIndex["bali__id"][0].artifactFile, "artifacts/001-bali-id.json.gz");
  assert.equal(payload.destinationIndex["tokyo__jp"][0].artifactFile, "artifacts/002-tokyo-jp.json.gz");
});

test("filterOutlinePolygonsForReferenceBounds keeps the destination cluster polygon", () => {
  const nearbyPolygon = [
    { latitude: 35.80, longitude: 139.60 },
    { latitude: 35.80, longitude: 139.90 },
    { latitude: 35.58, longitude: 139.90 },
    { latitude: 35.58, longitude: 139.60 },
    { latitude: 35.80, longitude: 139.60 },
  ];
  const distantIslandPolygon = [
    { latitude: 24.90, longitude: 153.80 },
    { latitude: 24.90, longitude: 154.10 },
    { latitude: 24.65, longitude: 154.10 },
    { latitude: 24.65, longitude: 153.80 },
    { latitude: 24.90, longitude: 153.80 },
  ];

  const filtered = filterOutlinePolygonsForReferenceBounds(
    [nearbyPolygon, distantIslandPolygon],
    {
      north: 35.78,
      south: 35.60,
      east: 139.88,
      west: 139.63,
    }
  );

  assert.equal(filtered.polygons.length, 1);
  assert.deepEqual(filtered.retainedIndexes, [0]);
  assert.deepEqual(filtered.cityBounds, deriveBoundsFromPolygons([nearbyPolygon]));
});
