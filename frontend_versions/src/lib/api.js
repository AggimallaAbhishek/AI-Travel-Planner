import { auth } from "@/service/firebaseConfig";
import { signOut as firebaseSignOut } from "firebase/auth";

export class ApiError extends Error {
  constructor(message, status, details = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

function isResponseJson(response) {
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.includes("application/json");
}

async function executeRequest(path, options = {}, token = "") {
  const headers = new Headers(options.headers ?? {});

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });
}

export async function apiFetch(path, options = {}) {
  let token = options.token;

  if (!token && auth?.currentUser) {
    token = await auth.currentUser.getIdToken();
  }

  let response;
  let didRetryWithRefreshedToken = false;

  try {
    response = await executeRequest(path, options, token);
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

  if (response.status === 401 && auth?.currentUser) {
    try {
      console.warn("[api] Received 401. Retrying with refreshed auth token.", {
        path,
      });
      token = await auth.currentUser.getIdToken(true);
      didRetryWithRefreshedToken = true;
      response = await executeRequest(path, options, token);
    } catch (refreshError) {
      console.error("[api] Failed to refresh auth token after 401 response", {
        path,
        message: refreshError instanceof Error ? refreshError.message : String(refreshError),
      });
    }
  }

  const data = isResponseJson(response) ? await response.json() : null;
  const requiresReauth =
    typeof data?.requiresReauth === "boolean" ? data.requiresReauth : response.status === 401;

  if (!response.ok) {
    if (response.status === 401 && auth?.currentUser && requiresReauth) {
      try {
        console.warn("[api] Session unauthorized after retry. Signing out user.", {
          path,
          didRetryWithRefreshedToken,
          requiresReauth,
        });
        await firebaseSignOut(auth);
      } catch (signOutError) {
        console.error("[api] Failed to sign out after unauthorized response", {
          path,
          message: signOutError instanceof Error ? signOutError.message : String(signOutError),
        });
      }
    }

    throw new ApiError(
      data?.message ?? "The request could not be completed.",
      response.status,
      {
        ...(data && typeof data === "object" ? data : {}),
        didRetryWithRefreshedToken,
        requiresReauth,
      }
    );
  }

  return data;
}
