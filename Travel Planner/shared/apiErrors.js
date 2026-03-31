export class ApiError extends Error {
  constructor(message, status, details = null, options = {}) {
    super(message);
    this.name = options.name ?? "ApiError";
    this.status = status;
    this.details = details;

    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export function resolveApiRequestFailure(error) {
  const errorName = error instanceof Error ? error.name : "";
  const cause = error instanceof Error ? error.message : String(error);

  if (errorName === "AbortError") {
    return new ApiError(
      "Request was canceled.",
      0,
      { cause },
      {
        name: "AbortError",
        cause: error,
      }
    );
  }

  if (errorName === "TimeoutError") {
    return new ApiError(
      "Request timed out. Please try again.",
      0,
      { cause },
      {
        name: "TimeoutError",
        cause: error,
      }
    );
  }

  return new ApiError(
    "Unable to reach the API server. Start backend with `npm run server` and retry.",
    0,
    { cause },
    {
      cause: error,
    }
  );
}
