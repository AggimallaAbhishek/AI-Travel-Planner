import { apiFetch } from "./api";

export async function fetchTripCityMap(tripId, { signal } = {}) {
  const response = await apiFetch(`/api/trips/${tripId}/city-map`, {
    signal,
  });

  return response?.cityMap ?? null;
}
