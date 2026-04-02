const planningCounters = new Map();

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function buildMetricKey(name, tags = {}) {
  const normalizedName = normalizeText(name, "unknown_metric");
  const normalizedTags = Object.entries(tags)
    .map(([key, value]) => [normalizeText(key), normalizeText(String(value ?? ""))])
    .filter(([key, value]) => key && value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join(",");

  return normalizedTags ? `${normalizedName}|${normalizedTags}` : normalizedName;
}

export function incrementPlanningMetric(name, tags = {}) {
  const metricKey = buildMetricKey(name, tags);
  const nextCount = (planningCounters.get(metricKey) ?? 0) + 1;
  planningCounters.set(metricKey, nextCount);
  console.info("[metrics] planning counter incremented", {
    metric: name,
    tags,
    count: nextCount,
  });
}

export function getPlanningMetricSnapshot() {
  return Object.fromEntries(planningCounters.entries());
}

export function resetPlanningMetrics() {
  planningCounters.clear();
}
