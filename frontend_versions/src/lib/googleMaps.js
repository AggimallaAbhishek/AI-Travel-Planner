const GOOGLE_MAPS_SCRIPT_ID = "voy-google-maps-js";

let googleMapsPromise = null;

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || fallback;
}

export function getGoogleMapsBrowserKey() {
  return normalizeText(import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY);
}

export function hasGoogleMapsBrowserKey() {
  return Boolean(getGoogleMapsBrowserKey());
}

function resolveGoogleMapsInstance() {
  return globalThis?.google?.maps ?? null;
}

function buildGoogleMapsScriptUrl(apiKey) {
  const params = new URLSearchParams({
    key: apiKey,
    v: "weekly",
  });

  return `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
}

export async function loadGoogleMapsApi() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return null;
  }

  const existingMaps = resolveGoogleMapsInstance();
  if (existingMaps) {
    return existingMaps;
  }

  if (googleMapsPromise) {
    return googleMapsPromise;
  }

  const apiKey = getGoogleMapsBrowserKey();
  if (!apiKey) {
    console.warn("[google-maps] Browser API key is missing");
    return null;
  }

  console.info("[google-maps] Loading Google Maps JavaScript API");

  googleMapsPromise = new Promise((resolve, reject) => {
    const existingScript = document.getElementById(GOOGLE_MAPS_SCRIPT_ID);

    const handleLoad = () => {
      const maps = resolveGoogleMapsInstance();

      if (!maps) {
        googleMapsPromise = null;
        reject(new Error("Google Maps loaded without the expected maps object."));
        return;
      }

      resolve(maps);
    };

    const handleError = () => {
      googleMapsPromise = null;
      reject(new Error("Google Maps JavaScript API failed to load."));
    };

    if (existingScript) {
      existingScript.addEventListener("load", handleLoad, { once: true });
      existingScript.addEventListener("error", handleError, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.id = GOOGLE_MAPS_SCRIPT_ID;
    script.async = true;
    script.defer = true;
    script.src = buildGoogleMapsScriptUrl(apiKey);
    script.addEventListener("load", handleLoad, { once: true });
    script.addEventListener("error", handleError, { once: true });
    document.head.appendChild(script);
  });

  return googleMapsPromise;
}
