import { IMAGE_FALLBACKS } from "../imageManifest.js";

const DEFAULT_IMAGE_TIMEOUT_MS = 8_000;
const DEFAULT_FONT_TIMEOUT_MS = 10_000;

const PDF_ICON_ASSET_URLS = {
  location: "/pdf-icons/location.svg",
  stay: "/pdf-icons/stay.svg",
  dining: "/pdf-icons/dining.svg",
  flight: "/pdf-icons/flight.svg",
  budget: "/pdf-icons/budget.svg",
  tips: "/pdf-icons/tips.svg",
  map: "/pdf-icons/map.svg",
};

const PDF_FONT_SOURCES = [
  {
    family: "Poppins",
    style: "normal",
    vfsFileName: "Poppins-Regular.ttf",
    url: "/pdf-fonts/Poppins-Regular.ttf",
  },
  {
    family: "Poppins",
    style: "bold",
    vfsFileName: "Poppins-SemiBold.ttf",
    url: "/pdf-fonts/Poppins-SemiBold.ttf",
  },
  {
    family: "Inter",
    style: "normal",
    vfsFileName: "Inter-Regular.ttf",
    url: "/pdf-fonts/Inter-Regular.ttf",
  },
  {
    family: "Inter",
    style: "bold",
    vfsFileName: "Inter-SemiBold.ttf",
    url: "/pdf-fonts/Inter-SemiBold.ttf",
  },
];

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  return value.trim() || fallback;
}

function isAllowedAssetUrl(value) {
  const source = normalizeText(value);
  if (!source) {
    return false;
  }

  if (source.startsWith("/")) {
    return true;
  }

  try {
    const parsed = new URL(source);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function toBase64(arrayBuffer) {
  if (typeof globalThis.Buffer !== "undefined") {
    return globalThis.Buffer.from(arrayBuffer).toString("base64");
  }

  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

async function fetchWithTimeout(url, timeoutMs, externalSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  if (externalSignal?.aborted) {
    clearTimeout(timer);
    throw new Error("Aborted before fetch start.");
  }

  const onAbort = () => controller.abort();
  externalSignal?.addEventListener("abort", onAbort);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      credentials: "omit",
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch ${url} (HTTP ${response.status}).`);
    }

    return response;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onAbort);
  }
}

async function resolveImageDataUrl(
  url,
  { timeoutMs = DEFAULT_IMAGE_TIMEOUT_MS, signal, cache, disableImages = false } = {}
) {
  if (disableImages || !isAllowedAssetUrl(url)) {
    return "";
  }

  const cacheKey = `image:${url}`;
  if (cache?.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const pending = (async () => {
    try {
      const response = await fetchWithTimeout(url, timeoutMs, signal);
      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) {
        throw new Error(`Unsupported image content type: ${blob.type}`);
      }

      const data = await blob.arrayBuffer();
      const base64 = toBase64(data);
      return `data:${blob.type};base64,${base64}`;
    } catch (error) {
      console.warn("[trip-pdf:assets] Failed to load image asset", {
        url,
        message: error instanceof Error ? error.message : String(error),
      });
      return "";
    }
  })();

  cache?.set(cacheKey, pending);
  return pending;
}

async function resolveFontPayload(
  font,
  { timeoutMs = DEFAULT_FONT_TIMEOUT_MS, signal, cache } = {}
) {
  if (!isAllowedAssetUrl(font.url)) {
    return null;
  }

  const cacheKey = `font:${font.url}`;
  if (cache?.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const pending = (async () => {
    try {
      const response = await fetchWithTimeout(font.url, timeoutMs, signal);
      const arrayBuffer = await response.arrayBuffer();
      return toBase64(arrayBuffer);
    } catch (error) {
      console.warn("[trip-pdf:assets] Failed to load font file", {
        fontUrl: font.url,
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  })();

  cache?.set(cacheKey, pending);
  return pending;
}

export async function registerPdfFonts(
  doc,
  { disableFontEmbedding = false, signal, cache = new Map() } = {}
) {
  const defaultFontSet = {
    headingFamily: "helvetica",
    bodyFamily: "helvetica",
    registeredFonts: [],
  };

  if (disableFontEmbedding) {
    console.info("[trip-pdf:assets] Font embedding disabled via options");
    return defaultFontSet;
  }

  const registered = [];

  for (const font of PDF_FONT_SOURCES) {
    const payload = await resolveFontPayload(font, { signal, cache });
    if (!payload) {
      continue;
    }

    try {
      doc.addFileToVFS(font.vfsFileName, payload);
      doc.addFont(font.vfsFileName, font.family, font.style);
      registered.push(`${font.family}:${font.style}`);
    } catch (error) {
      console.warn("[trip-pdf:assets] Failed to register font payload", {
        family: font.family,
        style: font.style,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const hasPoppins = registered.some((item) => item.startsWith("Poppins:"));
  const hasInter = registered.some((item) => item.startsWith("Inter:"));

  const result = {
    headingFamily: hasPoppins ? "Poppins" : "helvetica",
    bodyFamily: hasInter ? "Inter" : "helvetica",
    registeredFonts: registered,
  };

  console.info("[trip-pdf:assets] Font registration complete", {
    headingFamily: result.headingFamily,
    bodyFamily: result.bodyFamily,
    registeredCount: result.registeredFonts.length,
  });

  return result;
}

function buildImageCandidates(primary, fallback) {
  const candidates = [primary, fallback].filter(Boolean);
  return [...new Set(candidates)];
}

async function resolveBestImageDataUrl(
  primary,
  fallback,
  { timeoutMs, signal, cache, disableImages } = {}
) {
  const candidates = buildImageCandidates(primary, fallback);

  for (const candidate of candidates) {
    const dataUrl = await resolveImageDataUrl(candidate, {
      timeoutMs,
      signal,
      cache,
      disableImages,
    });

    if (dataUrl) {
      return dataUrl;
    }
  }

  return "";
}

export async function resolvePdfAssets(
  model,
  {
    timeoutMs = DEFAULT_IMAGE_TIMEOUT_MS,
    signal,
    disableImages = false,
    logoUrl = "/logo-1.png",
    cache = new Map(),
  } = {}
) {
  const iconEntries = Object.entries(PDF_ICON_ASSET_URLS);

  const iconPromises = iconEntries.map(async ([iconKey, iconUrl]) => {
    const dataUrl = await resolveImageDataUrl(iconUrl, {
      timeoutMs,
      signal,
      cache,
      disableImages,
    });

    return [iconKey, dataUrl];
  });

  const dayImagePromises = (model?.itinerary?.days ?? []).map((day) =>
    resolveBestImageDataUrl(day.featureImageUrl, IMAGE_FALLBACKS.place, {
      timeoutMs,
      signal,
      cache,
      disableImages,
    })
  );

  const hotelImagePromises = (model?.recommendations?.hotels ?? []).map((hotel) =>
    resolveBestImageDataUrl(hotel.imageUrl, IMAGE_FALLBACKS.hotel, {
      timeoutMs,
      signal,
      cache,
      disableImages,
    })
  );

  const restaurantImagePromises = (model?.recommendations?.restaurants ?? []).map(
    (restaurant) =>
      resolveBestImageDataUrl(restaurant.imageUrl, IMAGE_FALLBACKS.restaurant, {
        timeoutMs,
        signal,
        cache,
        disableImages,
      })
  );

  const [logoImageDataUrl, heroImageDataUrl, mapImageDataUrl, ...rest] = await Promise.all([
    resolveBestImageDataUrl(logoUrl, IMAGE_FALLBACKS.avatar, {
      timeoutMs,
      signal,
      cache,
      disableImages,
    }),
    resolveBestImageDataUrl(model?.cover?.heroImageUrl, IMAGE_FALLBACKS.scenic, {
      timeoutMs,
      signal,
      cache,
      disableImages,
    }),
    resolveBestImageDataUrl(
      model?.mapRoute?.backgroundImageUrl,
      IMAGE_FALLBACKS.destination,
      {
        timeoutMs,
        signal,
        cache,
        disableImages,
      }
    ),
    ...iconPromises,
    ...dayImagePromises,
    ...hotelImagePromises,
    ...restaurantImagePromises,
  ]);

  const iconDataUrls = Object.fromEntries(
    rest.slice(0, iconEntries.length).map((entry) => entry)
  );

  let offset = iconEntries.length;
  const dayImageDataUrls = rest.slice(offset, offset + dayImagePromises.length);
  offset += dayImagePromises.length;
  const hotelImageDataUrls = rest.slice(offset, offset + hotelImagePromises.length);
  offset += hotelImagePromises.length;
  const restaurantImageDataUrls = rest.slice(offset, offset + restaurantImagePromises.length);

  console.info("[trip-pdf:assets] Resolved PDF assets", {
    hasLogo: Boolean(logoImageDataUrl),
    hasHero: Boolean(heroImageDataUrl),
    hasMap: Boolean(mapImageDataUrl),
    dayImages: dayImageDataUrls.filter(Boolean).length,
    hotelImages: hotelImageDataUrls.filter(Boolean).length,
    restaurantImages: restaurantImageDataUrls.filter(Boolean).length,
  });

  return {
    logoImageDataUrl,
    heroImageDataUrl,
    mapImageDataUrl,
    iconDataUrls,
    dayImageDataUrls,
    hotelImageDataUrls,
    restaurantImageDataUrls,
  };
}

export { PDF_ICON_ASSET_URLS };
