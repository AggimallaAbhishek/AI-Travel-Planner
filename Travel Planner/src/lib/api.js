import { auth } from "../service/firebaseConfig.js";
import { ApiError, resolveApiRequestFailure } from "../../shared/apiErrors.js";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

export async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  let token = options.token;

  if (!token && auth?.currentUser) {
    token = await auth.currentUser.getIdToken();
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  let response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch (error) {
    throw resolveApiRequestFailure(error);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : null;

  if (!response.ok) {
    throw new ApiError(
      data?.message ?? "The request could not be completed.",
      response.status,
      data
    );
  }

  return data;
}
