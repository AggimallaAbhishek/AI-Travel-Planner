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

test("recommendation image service falls back to Wikimedia Commons search when metadata is missing", async () => {
  const service = createRecommendationImageService({
    fetchImpl: async (url) => {
      if (String(url).includes("list=search")) {
        return {
          ok: true,
          async json() {
            return {
              query: {
                search: [
                  {
                    title: "File:Armani Hotel Dubai.jpg",
                  },
                ],
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
                  title: "File:Armani Hotel Dubai.jpg",
                  imageinfo: [
                    {
                      thumburl:
                        "https://upload.wikimedia.org/example/armani-hotel-dubai.jpg",
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

  const imageUrl = await service.resolveRecommendationImage(
    {
      name: "Armani Hotel",
      location: "Dubai, United Arab Emirates",
    },
    {
      destination: "Dubai, United Arab Emirates",
    }
  );

  assert.equal(
    imageUrl,
    "https://upload.wikimedia.org/example/armani-hotel-dubai.jpg"
  );
});
