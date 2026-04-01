import { auth } from "../service/firebaseConfig.js";
import {
  ApiError,
  createApiTimeoutError,
  resolveApiRequestFailure,
} from "../../shared/apiErrors.js";

const viteEnv = import.meta.env ?? {};
const API_BASE_URL = viteEnv.VITE_API_BASE_URL ?? "";
const DEFAULT_API_REQUEST_TIMEOUT_MS = Number.parseInt(
  viteEnv.VITE_API_REQUEST_TIMEOUT_MS ?? "",
  10
);
const FALLBACK_API_REQUEST_TIMEOUT_MS = 30_000;

function resolveApiRequestTimeoutMs(timeoutMs) {
  if (Number.isInteger(timeoutMs) && timeoutMs > 0) {
    return timeoutMs;
  }

  if (
    Number.isInteger(DEFAULT_API_REQUEST_TIMEOUT_MS) &&
    DEFAULT_API_REQUEST_TIMEOUT_MS > 0
  ) {
    return DEFAULT_API_REQUEST_TIMEOUT_MS;
  }

  return FALLBACK_API_REQUEST_TIMEOUT_MS;
}

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function sanitizeApiTextPayload(text) {
  const normalized = normalizeText(text);

  if (!normalized) {
    return "";
  }

  if (
    normalized.startsWith("<!DOCTYPE") ||
    normalized.startsWith("<!doctype") ||
    normalized.startsWith("<html")
  ) {
    return "";
  }

  if (normalized.includes("<body") || normalized.includes("</html>")) {
    return "";
  }

  return normalized.slice(0, 280);
}

function createManagedRequestSignal(parentSignal, timeoutMs) {
  const controller = new AbortController();
  let timeoutId = null;
  let timedOut = false;

  const clear = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  const abortFromParent = () => {
    clear();
    controller.abort(parentSignal?.reason);
  };

  if (parentSignal) {
    if (parentSignal.aborted) {
      abortFromParent();
    } else {
      parentSignal.addEventListener("abort", abortFromParent, { once: true });
    }
  }

  if (Number.isInteger(timeoutMs) && timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort(createApiTimeoutError("Request timed out. Please try again."));
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    didTimeout() {
      return timedOut;
    },
    cleanup() {
      clear();

      if (parentSignal) {
        parentSignal.removeEventListener("abort", abortFromParent);
      }
    },
  };
}

async function readApiResponsePayload(response) {
  const contentType = response.headers.get("content-type") ?? "";
  const rawText = await response.text();
  const text = sanitizeApiTextPayload(rawText);

  if (!rawText) {
    return {
      data: null,
      text: "",
      contentType,
    };
  }

  if (contentType.includes("application/json")) {
    try {
      return {
        data: JSON.parse(rawText),
        text,
        contentType,
      };
    } catch (error) {
      console.warn("[api] Failed to parse JSON response payload", {
        status: response.status,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    data: null,
    text,
    contentType,
  };
}

function resolveHttpFailureMessage({ status, data, text, statusText }) {
  if (typeof data?.message === "string" && data.message.trim()) {
    return data.message.trim();
  }

  if (text) {
    return text;
  }

  if (status === 401) {
    return "Authentication is required.";
  }

  if (status === 403) {
    return "You do not have access to this resource.";
  }

  if (status === 404) {
    return "The requested resource was not found.";
  }

  if (status === 408 || status === 504) {
    return "Request timed out. Please try again.";
  }

  if (status === 502 || status === 503) {
    return "The travel service is temporarily unavailable. Please try again.";
  }

  if (status >= 500) {
    return "Unexpected server error. Please try again.";
  }

  return normalizeText(statusText, "The request could not be completed.");
}

export async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  let token = options.token;
  const timeoutMs = resolveApiRequestTimeoutMs(options.timeoutMs);
  const managedSignal = createManagedRequestSignal(options.signal, timeoutMs);

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
      signal: managedSignal.signal,
    });
  } catch (error) {
    if (managedSignal.didTimeout()) {
      throw resolveApiRequestFailure(
        createApiTimeoutError("Request timed out. Please try again.", {
          cause: error,
        })
      );
    }

    throw resolveApiRequestFailure(error);
  } finally {
    managedSignal.cleanup();
  }

  const { data, text } = await readApiResponsePayload(response);

  if (!response.ok) {
    throw new ApiError(
      resolveHttpFailureMessage({
        status: response.status,
        data,
        text,
        statusText: response.statusText,
      }),
      response.status,
      data ?? (text ? { rawText: text } : null)
    );
  }

  return data ?? null;
}
