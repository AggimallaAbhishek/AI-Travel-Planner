import { apiFetch } from "./api";
import { getDestinationSuggestions } from "./destinationAutocomplete";

const AUTOCOMPLETE_CACHE = new Map();
const AUTOCOMPLETE_CACHE_TTL_MS = 5 * 60 * 1000;

function buildCacheKey(query) {
  return String(query ?? "")
    .trim()
    .toLowerCase();
}

function readCachedSuggestions(cacheKey) {
  const cached = AUTOCOMPLETE_CACHE.get(cacheKey);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    AUTOCOMPLETE_CACHE.delete(cacheKey);
    return null;
  }

  return cached.value;
}

function writeCachedSuggestions(cacheKey, suggestions) {
  AUTOCOMPLETE_CACHE.set(cacheKey, {
    value: suggestions,
    expiresAt: Date.now() + AUTOCOMPLETE_CACHE_TTL_MS,
  });
}

function normalizeSuggestions(suggestions = []) {
  return suggestions.map((suggestion) => ({
    label: String(suggestion?.label ?? "").trim(),
    primaryText: String(
      suggestion?.primaryText ?? suggestion?.name ?? suggestion?.label ?? ""
    ).trim(),
    secondaryText: String(
      suggestion?.secondaryText ?? suggestion?.country ?? ""
    ).trim(),
    placeId: String(suggestion?.placeId ?? suggestion?.place_id ?? "").trim(),
    source: String(suggestion?.source ?? "local_index").trim() || "local_index",
  }))
  .filter((suggestion) => suggestion.label);
}

export function clearPlacesAutocompleteCache(query = "") {
  if (query) {
    AUTOCOMPLETE_CACHE.delete(buildCacheKey(query));
    return;
  }

  AUTOCOMPLETE_CACHE.clear();
}

export async function fetchPlacesAutocomplete(query, options = {}) {
  const normalizedQuery = String(query ?? "").trim();
  if (normalizedQuery.length < 2) {
    return normalizeSuggestions(getDestinationSuggestions(normalizedQuery, { limit: 8 }));
  }

  const cacheKey = buildCacheKey(normalizedQuery);
  if (!options.force) {
    const cached = readCachedSuggestions(cacheKey);
    if (cached) {
      console.info("[places-autocomplete] Returning cached suggestions", {
        query: normalizedQuery,
        count: cached.length,
      });
      return cached;
    }
  }

  try {
    console.info("[places-autocomplete] Fetching server suggestions", {
      query: normalizedQuery,
    });
    const response = await apiFetch(
      `/api/places/autocomplete?q=${encodeURIComponent(normalizedQuery)}`,
      {
        signal: options.signal,
      }
    );
    const suggestions = normalizeSuggestions(response?.suggestions ?? []);
    const resolvedSuggestions =
      suggestions.length > 0
        ? suggestions
        : normalizeSuggestions(getDestinationSuggestions(normalizedQuery, { limit: 8 }));

    writeCachedSuggestions(cacheKey, resolvedSuggestions);
    return resolvedSuggestions;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw error;
    }

    console.warn("[places-autocomplete] Falling back to local suggestions", {
      query: normalizedQuery,
      message: error?.message ?? String(error),
    });
    const fallbackSuggestions = normalizeSuggestions(
      getDestinationSuggestions(normalizedQuery, { limit: 8 })
    );
    writeCachedSuggestions(cacheKey, fallbackSuggestions);
    return fallbackSuggestions;
  }
}
