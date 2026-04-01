import { apiFetch } from "./api";

export async function fetchTripCityMap(tripId, { signal } = {}) {
  const response = await apiFetch(`/api/trips/${tripId}/city-map`, {
    signal,
    timeoutMs: 30_000,
  });

  return response?.cityMap ?? null;
}
