import { MAP_DESTINATIONS, VOYAGR_DESTINATIONS } from "../src/components/voyagr/data.js";

const EXTRA_DESTINATIONS = [
  { name: "Varanasi", country: "India" },
  { name: "Kerala", country: "India" },
  { name: "Ladakh", country: "India" },
  { name: "Tokyo", country: "Japan" },
  { name: "Kyoto", country: "Japan" },
  { name: "Singapore", country: "Singapore" },
];

const MAX_SUGGESTIONS = 8;

function normalizeValue(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s,-]/gu, "");
}

function buildLabel(name, country) {
  const safeName = String(name ?? "").trim();
  const safeCountry = String(country ?? "").trim();

  if (!safeCountry || safeCountry.toLowerCase() === safeName.toLowerCase()) {
    return safeName;
  }

  return `${safeName}, ${safeCountry}`;
}

function scoreSuggestion(suggestion, normalizedQuery) {
  if (!normalizedQuery) {
    return suggestion.priority;
  }

  const { normalizedName, normalizedCountry, normalizedLabel } = suggestion;

  let score = 0;

  if (normalizedName === normalizedQuery) {
    score += 350;
  } else if (normalizedName.startsWith(normalizedQuery)) {
    score += 220;
  } else if (normalizedName.includes(normalizedQuery)) {
    score += 140;
  }

  if (normalizedLabel.startsWith(normalizedQuery)) {
    score += 110;
  } else if (normalizedLabel.includes(normalizedQuery)) {
    score += 65;
  }

  if (normalizedCountry.startsWith(normalizedQuery)) {
    score += 70;
  } else if (normalizedCountry.includes(normalizedQuery)) {
    score += 45;
  }

  return score + suggestion.priority;
}

function toSuggestion(item, priority) {
  const name = String(item?.name ?? "").trim();
  const country = String(item?.country ?? "").trim();
  const label = buildLabel(name, country);

  if (!name) {
    return null;
  }

  return {
    name,
    country,
    label,
    priority,
    normalizedName: normalizeValue(name),
    normalizedCountry: normalizeValue(country),
    normalizedLabel: normalizeValue(label),
  };
}

function buildDestinationIndex() {
  const merged = [
    ...VOYAGR_DESTINATIONS.map((item) => toSuggestion(item, 90)),
    ...MAP_DESTINATIONS.map((item) => toSuggestion(item, 70)),
    ...EXTRA_DESTINATIONS.map((item) => toSuggestion(item, 60)),
  ].filter(Boolean);

  const uniqueSuggestions = [];
  const seenLabels = new Set();

  for (const suggestion of merged) {
    const key = suggestion.normalizedLabel;
    if (!key || seenLabels.has(key)) {
      continue;
    }

    seenLabels.add(key);
    uniqueSuggestions.push(suggestion);
  }

  return uniqueSuggestions;
}

const DESTINATION_INDEX = buildDestinationIndex();

export function getDestinationSuggestions(query, options = {}) {
  const normalizedQuery = normalizeValue(query);
  const limit = Number.isInteger(options.limit)
    ? Math.max(1, Math.min(options.limit, 20))
    : MAX_SUGGESTIONS;

  const ranked = DESTINATION_INDEX.map((suggestion) => ({
    ...suggestion,
    score: scoreSuggestion(suggestion, normalizedQuery),
  }))
    .filter((suggestion) =>
      normalizedQuery ? suggestion.score > suggestion.priority : true
    )
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.label.localeCompare(right.label);
    })
    .slice(0, limit)
    .map((suggestion) => ({
      label: suggestion.label,
      name: suggestion.name,
      country: suggestion.country,
      primaryText: suggestion.name,
      secondaryText: suggestion.country,
      placeId: "",
      source: "local_index",
    }));

  console.debug("[destination-autocomplete] suggestions resolved", {
    query: String(query ?? ""),
    matches: ranked.length,
  });

  return ranked;
}
