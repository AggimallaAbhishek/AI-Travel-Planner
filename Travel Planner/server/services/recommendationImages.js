const WIKIMEDIA_COMMONS_API_URL = "https://commons.wikimedia.org/w/api.php";
const WIKIDATA_ENTITY_DATA_URL =
  "https://www.wikidata.org/wiki/Special:EntityData";
const DEFAULT_IMAGE_TIMEOUT_MS = 10_000;
const DEFAULT_WIKIMEDIA_IMAGE_WIDTH = 1280;
const DEFAULT_IMAGE_USER_AGENT =
  "AI-Travel-Planner/1.0 (recommendation images)";
const DEFAULT_WIKIMEDIA_MIN_INTERVAL_MS = 250;
const DEFAULT_ENABLE_WIKIMEDIA_LOOKUPS = false;
const LOREM_FLICKR_BASE_URL = "https://loremflickr.com";

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || fallback;
}

function normalizeExternalUrl(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return fallback;
  }

  return trimmed;
}

function sleep(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function buildTimedFetchOptions(options = {}, timeoutMs) {
  return {
    ...options,
    ...(typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.timeout === "function"
      ? { signal: AbortSignal.timeout(timeoutMs) }
      : {}),
  };
}

function normalizeCommonsFileTitle(value) {
  const title = normalizeText(value);

  if (!title) {
    return "";
  }

  if (/^file:/i.test(title)) {
    return `File:${title.slice(5).trim()}`;
  }

  if (/\.(jpg|jpeg|png|webp|gif|svg)$/i.test(title)) {
    return `File:${title}`;
  }

  return "";
}

function buildCommonsImageInfoUrl({
  commonsApiUrl,
  title,
  imageWidth,
}) {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    prop: "imageinfo",
    titles: title,
    iiprop: "url",
    iiurlwidth: String(imageWidth),
    redirects: "1",
  });

  return `${commonsApiUrl}?${params.toString()}`;
}

function buildWikidataEntityUrl({ wikidataEntityDataUrl, wikidataId }) {
  return `${wikidataEntityDataUrl}/${encodeURIComponent(wikidataId)}.json`;
}

function extractFirstImageInfoUrl(payload = {}) {
  const pages = Array.isArray(payload?.query?.pages) ? payload.query.pages : [];
  const imageInfo = pages[0]?.imageinfo?.[0];

  return normalizeExternalUrl(imageInfo?.thumburl ?? imageInfo?.url);
}

function extractWikidataImageFileName(payload = {}, wikidataId) {
  const entity = payload?.entities?.[wikidataId];
  const imageClaim = Array.isArray(entity?.claims?.P18) ? entity.claims.P18[0] : null;
  const fileName = normalizeText(
    imageClaim?.mainsnak?.datavalue?.value
  );

  return normalizeCommonsFileTitle(fileName);
}

function createStableSignature(value) {
  const normalizedValue = normalizeText(value, "fallback-image");

  let hash = 0;
  for (let index = 0; index < normalizedValue.length; index += 1) {
    hash = (hash << 5) - hash + normalizedValue.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash % 10000);
}

function toTagTokens(value, maxTokens = 3) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, maxTokens);
}

function buildFastOnlineImageUrl(item = {}, options = {}) {
  const categoryTags =
    options.category === "restaurant"
      ? ["restaurant", "food", "dining"]
      : ["hotel", "room", "lobby"];
  const destinationTags = toTagTokens(options.destination, 2);
  const nameTags = toTagTokens(item.name, 1);
  const allTags = [...categoryTags, ...destinationTags, ...nameTags];
  const tagPath = allTags.join(",");
  const signature = createStableSignature(
    `${options.category ?? ""}::${normalizeText(options.destination)}::${normalizeText(item.name)}`
  );

  return `${LOREM_FLICKR_BASE_URL}/720/480/${tagPath}?lock=${signature}`;
}

export function createRecommendationImageService({
  fetchImpl = fetch,
  timeoutMs = DEFAULT_IMAGE_TIMEOUT_MS,
  commonsApiUrl = WIKIMEDIA_COMMONS_API_URL,
  wikidataEntityDataUrl = WIKIDATA_ENTITY_DATA_URL,
  userAgent = DEFAULT_IMAGE_USER_AGENT,
  imageWidth = DEFAULT_WIKIMEDIA_IMAGE_WIDTH,
  minIntervalMs = DEFAULT_WIKIMEDIA_MIN_INTERVAL_MS,
  enableWikimediaLookups = DEFAULT_ENABLE_WIKIMEDIA_LOOKUPS,
  cache = new Map(),
} = {}) {
  let nextRequestAt = 0;

  async function fetchJson(url) {
    const now = Date.now();
    const scheduledAt = Math.max(nextRequestAt, now);
    const waitMs = Math.max(0, scheduledAt - now);
    nextRequestAt = scheduledAt + minIntervalMs;

    if (waitMs > 0) {
      console.info("[recommendation-images] Waiting before next image request", {
        waitMs,
      });
      await sleep(waitMs);
    }

    const response = await fetchImpl(
      url,
      buildTimedFetchOptions(
        {
          headers: {
            Accept: "application/json",
            "User-Agent": userAgent,
          },
        },
        timeoutMs
      )
    );

    if (!response.ok) {
      throw new Error(`Image lookup failed with status ${response.status}.`);
    }

    return response.json();
  }

  async function readCached(key, loader) {
    if (cache.has(key)) {
      return cache.get(key);
    }

    const value = await loader();
    cache.set(key, value);
    return value;
  }

  async function resolveCommonsImageByTitle(title) {
    const normalizedTitle = normalizeCommonsFileTitle(title);

    if (!normalizedTitle) {
      return "";
    }

    const cacheKey = `commons-title::${normalizedTitle}`;
    return readCached(cacheKey, async () => {
      console.info("[recommendation-images] Resolving Wikimedia Commons image", {
        title: normalizedTitle,
      });

      const payload = await fetchJson(
        buildCommonsImageInfoUrl({
          commonsApiUrl,
          title: normalizedTitle,
          imageWidth,
        })
      );

      return extractFirstImageInfoUrl(payload);
    });
  }

  async function resolveCommonsImageByWikidataId(wikidataId) {
    const normalizedWikidataId = normalizeText(wikidataId);

    if (!normalizedWikidataId) {
      return "";
    }

    const cacheKey = `wikidata::${normalizedWikidataId}`;
    return readCached(cacheKey, async () => {
      console.info("[recommendation-images] Resolving Wikidata entity image", {
        wikidataId: normalizedWikidataId,
      });

      const payload = await fetchJson(
        buildWikidataEntityUrl({
          wikidataEntityDataUrl,
          wikidataId: normalizedWikidataId,
        })
      );
      const fileTitle = extractWikidataImageFileName(payload, normalizedWikidataId);

      if (!fileTitle) {
        return "";
      }

      return resolveCommonsImageByTitle(fileTitle);
    });
  }

  async function resolveRecommendationImage(item = {}, options = {}) {
    const directImageUrl = normalizeExternalUrl(
      item.imageUrl ?? item.photoUrl ?? item.hotelImageUrl ?? item.sourceImageUrl
    );

    if (directImageUrl) {
      return directImageUrl;
    }

    if (enableWikimediaLookups) {
      const commonsTitle = normalizeCommonsFileTitle(
        item.wikimediaCommonsTitle ?? item.wikimediaCommons
      );

      try {
        if (commonsTitle) {
          const commonsImageUrl = await resolveCommonsImageByTitle(commonsTitle);
          if (commonsImageUrl) {
            return commonsImageUrl;
          }
        }

        const wikidataImageUrl = await resolveCommonsImageByWikidataId(item.wikidataId);
        if (wikidataImageUrl) {
          return wikidataImageUrl;
        }
      } catch (error) {
        console.error("[recommendation-images] Failed to resolve image metadata", {
          name: item?.name ?? "",
          location: item?.location ?? "",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return buildFastOnlineImageUrl(item, options);
  }

  async function enrichRecommendationItems(items = [], options = {}) {
    const safeItems = Array.isArray(items) ? items : [];
    const enrichedItems = [];

    for (const item of safeItems) {
      const imageUrl = await resolveRecommendationImage(item, options);

      if (!imageUrl) {
        enrichedItems.push(item);
        continue;
      }

      enrichedItems.push({
        ...item,
        imageUrl,
      });
    }

    return enrichedItems;
  }

  async function enrichDestinationRecommendationImages({
    destination = "",
    hotels = [],
    restaurants = [],
  } = {}) {
    const [nextHotels, nextRestaurants] = await Promise.all([
      enrichRecommendationItems(hotels, {
        destination,
        category: "hotel",
      }),
      enrichRecommendationItems(restaurants, {
        destination,
        category: "restaurant",
      }),
    ]);

    return {
      hotels: nextHotels,
      restaurants: nextRestaurants,
    };
  }

  return {
    cache,
    resolveRecommendationImage,
    enrichRecommendationItems,
    enrichDestinationRecommendationImages,
  };
}

const recommendationImageService = createRecommendationImageService();

export const enrichDestinationRecommendationImages =
  recommendationImageService.enrichDestinationRecommendationImages;
