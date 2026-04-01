const DEFAULT_EXTERNAL_READ_RETRIES = 0;

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || fallback;
}

function normalizeInteger(value, fallback = null) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function normalizeStatusCode(value) {
  const parsed = normalizeInteger(value, null);
  return parsed !== null && parsed >= 100 ? parsed : null;
}

export class ExternalRequestError extends Error {
  constructor(
    message,
    {
      kind = "unknown",
      status = null,
      retryable = false,
      provider = "",
      operation = "",
      cause = undefined,
    } = {}
  ) {
    super(message);
    this.name = "ExternalRequestError";
    this.kind = kind;
    this.status = status;
    this.retryable = retryable;
    this.provider = normalizeText(provider);
    this.operation = normalizeText(operation);

    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

export function createTimeoutError(
  message = "Request timed out.",
  { cause } = {}
) {
  const error = new Error(normalizeText(message, "Request timed out."));
  error.name = "TimeoutError";

  if (cause !== undefined) {
    error.cause = cause;
  }

  return error;
}

export function resolveExternalTimeoutMs({
  envVar = "",
  fallbackMs,
  minMs = 1_000,
  maxMs = 60_000,
} = {}) {
  const parsed = normalizeInteger(
    envVar ? process.env[envVar] ?? "" : "",
    null
  );

  if (parsed !== null && parsed >= minMs && parsed <= maxMs) {
    return parsed;
  }

  return fallbackMs;
}

export function resolveExternalReadRetries({
  envVar = "EXTERNAL_READ_RETRIES",
  fallback = DEFAULT_EXTERNAL_READ_RETRIES,
  maxRetries = 1,
} = {}) {
  const parsed = normalizeInteger(
    envVar ? process.env[envVar] ?? "" : "",
    null
  );

  if (parsed !== null && parsed >= 0 && parsed <= maxRetries) {
    return parsed;
  }

  return fallback;
}

export async function parseExternalErrorResponse(response) {
  const contentType = response?.headers?.get?.("content-type") ?? "";

  try {
    if (contentType.includes("application/json")) {
      const payload = await response.json();
      return normalizeText(
        payload?.error?.message ?? payload?.message,
        `HTTP ${response?.status ?? 500}`
      );
    }

    const text = await response.text();
    return normalizeText(text, `HTTP ${response?.status ?? 500}`);
  } catch (error) {
    return normalizeText(
      error instanceof Error ? error.message : String(error),
      `HTTP ${response?.status ?? 500}`
    );
  }
}

function classifyStatusError(status = null) {
  if (status === null) {
    return {
      kind: "unknown",
      retryable: false,
    };
  }

  if (status === 408 || status === 504) {
    return {
      kind: "timeout",
      retryable: true,
    };
  }

  if (status === 401 || status === 403) {
    return {
      kind: "auth",
      retryable: false,
    };
  }

  if (status === 429) {
    return {
      kind: "quota",
      retryable: false,
    };
  }

  if (status >= 500) {
    return {
      kind: "upstream_5xx",
      retryable: true,
    };
  }

  if (status >= 400) {
    return {
      kind: "upstream_4xx",
      retryable: false,
    };
  }

  return {
    kind: "unknown",
    retryable: false,
  };
}

export function classifyExternalRequestFailure(error) {
  if (error instanceof ExternalRequestError) {
    return {
      kind: error.kind,
      status: error.status,
      retryable: error.retryable,
      message: error.message,
      error,
    };
  }

  const status = normalizeStatusCode(
    error?.status ?? error?.statusCode ?? error?.code
  );
  const message = normalizeText(
    error instanceof Error ? error.message : String(error),
    "External request failed."
  );
  const name = normalizeText(error?.name).toLowerCase();
  const lowerMessage = message.toLowerCase();

  if (
    name === "timeouterror" ||
    lowerMessage.includes("timed out") ||
    lowerMessage.includes("timeout") ||
    lowerMessage.includes("etimedout")
  ) {
    return {
      kind: "timeout",
      status,
      retryable: true,
      message,
      error,
    };
  }

  if (name === "aborterror") {
    return {
      kind: "timeout",
      status,
      retryable: true,
      message,
      error,
    };
  }

  if (status !== null) {
    const statusClassification = classifyStatusError(status);
    return {
      kind: statusClassification.kind,
      status,
      retryable: statusClassification.retryable,
      message,
      error,
    };
  }

  if (
    lowerMessage.includes("fetch failed") ||
    lowerMessage.includes("network") ||
    lowerMessage.includes("socket hang up") ||
    lowerMessage.includes("econnreset") ||
    lowerMessage.includes("enotfound") ||
    lowerMessage.includes("eai_again") ||
    lowerMessage.includes("connection terminated") ||
    lowerMessage.includes("failed to fetch")
  ) {
    return {
      kind: "network",
      status: null,
      retryable: true,
      message,
      error,
    };
  }

  return {
    kind: "unknown",
    status: null,
    retryable: false,
    message,
    error,
  };
}

export function buildTimedFetchOptions(options = {}, timeoutMs = 10_000) {
  return {
    ...options,
    ...(typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.timeout === "function" &&
    !options.signal
      ? { signal: AbortSignal.timeout(timeoutMs) }
      : {}),
  };
}

export async function runExternalRequest({
  provider = "",
  operation = "",
  timeoutMs = 10_000,
  retries = DEFAULT_EXTERNAL_READ_RETRIES,
  execute,
  logger = console,
  fallbackPath = "",
} = {}) {
  const normalizedProvider = normalizeText(provider, "external");
  const normalizedOperation = normalizeText(operation, "request");
  const maxAttempts = Math.max(1, retries + 1);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = Date.now();

    try {
      return await execute({
        provider: normalizedProvider,
        operation: normalizedOperation,
        timeoutMs,
        attempt,
        maxAttempts,
      });
    } catch (error) {
      const classified = classifyExternalRequestFailure(error);
      const wrappedError =
        error instanceof ExternalRequestError
          ? error
          : new ExternalRequestError(classified.message, {
              kind: classified.kind,
              status: classified.status,
              retryable: classified.retryable,
              provider: normalizedProvider,
              operation: normalizedOperation,
              cause: error,
            });
      const retryable = wrappedError.retryable && attempt < maxAttempts;
      const logFn = retryable ? logger.warn : logger.error;

      logFn?.("[external-request] External request failed", {
        provider: normalizedProvider,
        operation: normalizedOperation,
        timeoutMs,
        attempt,
        maxAttempts,
        durationMs: Date.now() - startedAt,
        kind: wrappedError.kind,
        status: wrappedError.status,
        retryable,
        fallbackPath: normalizeText(fallbackPath),
        message: wrappedError.message,
      });

      if (!retryable) {
        throw wrappedError;
      }
    }
  }

  throw new ExternalRequestError("External request exhausted all retry attempts.", {
    kind: "unknown",
    provider: normalizeText(provider),
    operation: normalizeText(operation),
  });
}

export async function fetchWithExternalRequest({
  provider = "",
  operation = "",
  url,
  fetchImpl = fetch,
  timeoutMs = 10_000,
  retries = DEFAULT_EXTERNAL_READ_RETRIES,
  request = {},
  logger = console,
  fallbackPath = "",
  parseErrorResponse = parseExternalErrorResponse,
} = {}) {
  return runExternalRequest({
    provider,
    operation,
    timeoutMs,
    retries,
    logger,
    fallbackPath,
    execute: async () => {
      const response = await fetchImpl(
        url,
        buildTimedFetchOptions(request, timeoutMs)
      );

      if (!response.ok) {
        const responseMessage = await parseErrorResponse(response);
        const statusClassification = classifyStatusError(response.status);
        throw new ExternalRequestError(
          `${normalizeText(provider, "External")} ${normalizeText(
            operation,
            "request"
          )} failed with status ${response.status}: ${responseMessage}`,
          {
            kind: statusClassification.kind,
            status: response.status,
            retryable: statusClassification.retryable,
            provider,
            operation,
          }
        );
      }

      return response;
    },
  });
}
