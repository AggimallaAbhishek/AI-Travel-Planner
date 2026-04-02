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

/**
 * Custom event dispatched when the API layer detects a true session expiry
 * that requires re-authentication. Components can listen for this to show
 * an inline re-auth modal without navigating away.
 */
export const SESSION_EXPIRED_EVENT = "voyagr:session-expired";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";
const REQUEST_TIMEOUT_MS = Number(
  import.meta.env.VITE_API_REQUEST_TIMEOUT_MS ?? 30000
);

function isResponseJson(response) {
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.includes("application/json");
}

/**
 * Returns true when a token-refresh failure looks like a transient network
 * problem rather than a genuine auth revocation.
 */
function isTransientRefreshError(error) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("network") ||
    message.includes("failed to fetch") ||
    message.includes("load failed") ||
    message.includes("timeout") ||
    message.includes("econnreset") ||
    message.includes("enotfound") ||
    message.includes("socket hang up")
  );
}

/**
 * Build a merged AbortSignal that fires when *either* the caller's signal
 * or the internal timeout fires, whichever comes first.
 */
function buildMergedSignal(callerSignal, timeoutMs) {
  const controller = new AbortController();

  const timeoutId = setTimeout(() => {
    controller.abort(new DOMException("Request timed out.", "TimeoutError"));
  }, timeoutMs);

  // If the caller-provided signal fires first, forward it.
  if (callerSignal) {
    if (callerSignal.aborted) {
      clearTimeout(timeoutId);
      controller.abort(callerSignal.reason);
    } else {
      callerSignal.addEventListener(
        "abort",
        () => {
          clearTimeout(timeoutId);
          controller.abort(callerSignal.reason);
        },
        { once: true }
      );
    }
  }

  // Clean up the timeout once the merged controller fires (from any source).
  controller.signal.addEventListener(
    "abort",
    () => {
      clearTimeout(timeoutId);
    },
    { once: true }
  );

  return controller.signal;
}

async function executeRequest(path, options = {}, token = "") {
  const headers = new Headers(options.headers ?? {});

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const signal = buildMergedSignal(options.signal, REQUEST_TIMEOUT_MS);

  return fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal,
  });
}

export async function apiFetch(path, options = {}) {
  let token = options.token;

  if (!token && auth?.currentUser) {
    try {
      token = await auth.currentUser.getIdToken();
    } catch (tokenError) {
      console.warn("[api] Failed to get cached ID token", {
        path,
        message:
          tokenError instanceof Error
            ? tokenError.message
            : String(tokenError),
      });
      // Continue without a token — the server will respond with 401 and
      // the retry path below will attempt a forced refresh.
    }
  }

  let response;
  let didRetryWithRefreshedToken = false;

  try {
    response = await executeRequest(path, options, token);
  } catch (error) {
    // Preserve AbortError identity so callers can distinguish component-
    // unmount aborts from real failures.
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }

    // TimeoutError from our merged signal
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new ApiError(
        "The request timed out. Please check your connection and try again.",
        0,
        { cause: error.message }
      );
    }

    throw new ApiError(
      "Unable to reach the API server. Start backend with `npm run server` and retry.",
      0,
      {
        cause: error instanceof Error ? error.message : String(error),
      }
    );
  }

  // ── Token refresh on 401 ──────────────────────────────────────────────
  if (response.status === 401 && auth?.currentUser) {
    try {
      console.warn("[api] Received 401. Retrying with refreshed auth token.", {
        path,
      });
      token = await auth.currentUser.getIdToken(true);
      didRetryWithRefreshedToken = true;
      response = await executeRequest(path, options, token);
    } catch (refreshError) {
      // Transient network issue — don't sign the user out, just surface
      // the connectivity problem so the user can retry.
      if (isTransientRefreshError(refreshError)) {
        console.warn(
          "[api] Token refresh failed due to transient network error",
          {
            path,
            message:
              refreshError instanceof Error
                ? refreshError.message
                : String(refreshError),
          }
        );
        throw new ApiError(
          "Unable to refresh your session due to a network issue. Please check your connection and try again.",
          0,
          {
            cause:
              refreshError instanceof Error
                ? refreshError.message
                : String(refreshError),
            transient: true,
          }
        );
      }

      // Genuine auth failure — log and fall through to the sign-out path.
      console.error(
        "[api] Failed to refresh auth token after 401 response",
        {
          path,
          message:
            refreshError instanceof Error
              ? refreshError.message
              : String(refreshError),
        }
      );
    }
  }

  // ── Handle non-OK responses ───────────────────────────────────────────
  const data = isResponseJson(response) ? await response.json() : null;
  const requiresReauth =
    typeof data?.requiresReauth === "boolean"
      ? data.requiresReauth
      : response.status === 401;

  if (!response.ok) {
    if (response.status === 401 && auth?.currentUser && requiresReauth) {
      try {
        console.warn(
          "[api] Session unauthorized after retry. Signing out and dispatching session-expired event.",
          {
            path,
            didRetryWithRefreshedToken,
            requiresReauth,
          }
        );

        // Dispatch a custom event so the AuthContext / any listener can
        // show a re-auth modal instead of a silent redirect.
        window.dispatchEvent(
          new CustomEvent(SESSION_EXPIRED_EVENT, {
            detail: { path, didRetryWithRefreshedToken },
          })
        );

        await firebaseSignOut(auth);
      } catch (signOutError) {
        console.error(
          "[api] Failed to sign out after unauthorized response",
          {
            path,
            message:
              signOutError instanceof Error
                ? signOutError.message
                : String(signOutError),
          }
        );
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

export function fetchIndiaDestinations(query = "", options = {}) {
  const searchParams = new URLSearchParams();

  if (String(query ?? "").trim()) {
    searchParams.set("q", String(query ?? "").trim());
  }

  if (options.limit !== undefined) {
    searchParams.set("limit", String(options.limit));
  }

  const suffix = searchParams.toString();
  return apiFetch(`/api/india/destinations${suffix ? `?${suffix}` : ""}`, options);
}

export function fetchIndiaDestinationDetail(destinationId, options = {}) {
  return apiFetch(
    `/api/india/destinations/${encodeURIComponent(String(destinationId ?? "").trim())}`,
    options
  );
}

export function fetchIndiaTransportOptions(
  { origin = "", destination = "" } = {},
  options = {}
) {
  const searchParams = new URLSearchParams({
    origin: String(origin ?? "").trim(),
    destination: String(destination ?? "").trim(),
  });

  return apiFetch(`/api/india/transport/options?${searchParams}`, options);
}

export function fetchAuthSession(options = {}) {
  return apiFetch("/api/auth/session", options);
}
