import assert from "node:assert/strict";
import test from "node:test";
import {
  getCategoryFallback,
  getManifestImageForQuery,
  IMAGE_FALLBACKS,
} from "../src/lib/imageManifest.js";

test("getManifestImageForQuery resolves exact destination keywords before category fallbacks", () => {
  const image = getManifestImageForQuery("Machu Picchu, Peru", {
    category: "destination",
  });

  assert.ok(image.includes("machu") || image.includes("unsplash.com"));
});

test("getManifestImageForQuery falls back to semantic category imagery", () => {
  assert.equal(
    getManifestImageForQuery("", { category: "beach" }),
    getCategoryFallback("beach")
  );
  assert.equal(
    getManifestImageForQuery("", { category: "hotel" }),
    IMAGE_FALLBACKS.hotel
  );
});

test("getCategoryFallback returns scenic fallback for unknown categories", () => {
  assert.equal(getCategoryFallback("unknown"), IMAGE_FALLBACKS.scenic);
});
