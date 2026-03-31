import test from "node:test";
import assert from "node:assert/strict";
import { createRecommendationImageService } from "../server/services/recommendationImages.js";

test("recommendation image service keeps an existing remote image URL", async () => {
  const service = createRecommendationImageService({
    fetchImpl: async () => {
      throw new Error("fetch should not be called for direct image URLs");
    },
  });

  const imageUrl = await service.resolveRecommendationImage({
    name: "Armani Hotel Dubai",
    imageUrl: "https://images.example.com/armani.jpg",
  });

  assert.equal(imageUrl, "https://images.example.com/armani.jpg");
});

test("recommendation image service resolves images from Wikidata through Wikimedia Commons", async () => {
  const requests = [];
  const service = createRecommendationImageService({
    enableWikimediaLookups: true,
    minIntervalMs: 0,
    fetchImpl: async (url) => {
      requests.push(String(url));

      if (String(url).includes("Special:EntityData/Q42.json")) {
        return {
          ok: true,
          async json() {
            return {
              entities: {
                Q42: {
                  claims: {
                    P18: [
                      {
                        mainsnak: {
                          datavalue: {
                            value: "Douglas adams portrait cropped.jpg",
                          },
                        },
                      },
                    ],
                  },
                },
              },
            };
          },
        };
      }

      return {
        ok: true,
        async json() {
          return {
            query: {
              pages: [
                {
                  title: "File:Douglas adams portrait cropped.jpg",
                  imageinfo: [
                    {
                      thumburl:
                        "https://upload.wikimedia.org/example/douglas-adams.jpg",
                    },
                  ],
                },
              ],
            },
          };
        },
      };
    },
  });

  const imageUrl = await service.resolveRecommendationImage({
    name: "Example Hotel",
    wikidataId: "Q42",
  });

  assert.equal(
    imageUrl,
    "https://upload.wikimedia.org/example/douglas-adams.jpg"
  );
  assert.equal(requests.length, 2);
});

test("recommendation image service falls back to fast online image URLs when metadata is missing", async () => {
  let fetchCalls = 0;
  const service = createRecommendationImageService({
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("fetch should not be called in fast fallback mode");
    },
  });

  const imageUrl = await service.resolveRecommendationImage(
    {
      name: "Armani Hotel",
      location: "Dubai, United Arab Emirates",
    },
    {
      destination: "Dubai, United Arab Emirates",
    }
  );

  assert.ok(
    imageUrl.startsWith("https://loremflickr.com/640/420/")
  );
  assert.ok(
    imageUrl.includes("hotel,room,lobby,dubai,united,armani")
  );
  assert.equal(fetchCalls, 0);
});

test("recommendation image service builds restaurant-focused fast fallback tags", async () => {
  const service = createRecommendationImageService({
    fetchImpl: async () => {
      throw new Error("fetch should not be called in fast fallback mode");
    },
  });

  const imageUrl = await service.resolveRecommendationImage(
    {
      name: "Cedar Social",
      location: "Dubai, United Arab Emirates",
    },
    {
      destination: "Dubai, United Arab Emirates",
      category: "restaurant",
    }
  );

  assert.ok(
    imageUrl.startsWith("https://loremflickr.com/640/420/")
  );
  assert.ok(
    imageUrl.includes("restaurant,food,dining,dubai,united,cedar")
  );
});
