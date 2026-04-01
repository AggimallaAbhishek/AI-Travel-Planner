import { auth } from "@/service/firebaseConfig";

export class ApiError extends Error {
  constructor(message, status, details = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

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
    const isAbortError = error instanceof Error && error.name === "AbortError";
    throw new ApiError(
      isAbortError
        ? "Request timed out. Please try again."
        : "Unable to reach the API server. Start backend with `npm run server` and retry.",
      0,
      {
        cause: error instanceof Error ? error.message : String(error),
      }
    );
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
