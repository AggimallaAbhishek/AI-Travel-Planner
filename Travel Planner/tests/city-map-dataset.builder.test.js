import test from "node:test";
import assert from "node:assert/strict";
import { buildCityMapArtifactPayload } from "../scripts/buildCityMapDataset.mjs";

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
