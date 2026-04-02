const DEFAULT_ALLOWED_HOSTS = Object.freeze([
  "maps.googleapis.com",
  "generativelanguage.googleapis.com",
  "api.upstash.com",
]);

function parseAllowlist(value) {
  const configuredHosts = String(value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  return configuredHosts.length > 0 ? configuredHosts : [...DEFAULT_ALLOWED_HOSTS];
}

function isHostAllowed(hostname, allowlist) {
  const host = String(hostname ?? "").toLowerCase().trim();
  if (!host) {
    return false;
  }

  return allowlist.some((allowedHost) => {
    if (allowedHost === "*") {
      return true;
    }

    if (allowedHost === host) {
      return true;
    }

    return host.endsWith(`.${allowedHost}`);
  });
}

function resolveRequestUrl(input) {
  if (input instanceof URL) {
    return input;
  }

  if (typeof input === "string") {
    return new URL(input);
  }

  if (input && typeof input.url === "string") {
    return new URL(input.url);
  }

  throw new Error("Invalid outbound request URL.");
}

export async function safeFetch(input, init = {}, options = {}) {
  const requestUrl = resolveRequestUrl(input);
  const allowedHosts = parseAllowlist(
    options.allowedHosts ?? process.env.OUTBOUND_ALLOWED_HOSTS
  );

  if (!isHostAllowed(requestUrl.hostname, allowedHosts)) {
    const error = new Error(
      `Outbound request blocked for disallowed host: ${requestUrl.hostname}`
    );
    error.code = "network/disallowed-host";
    throw error;
  }

  return fetch(requestUrl, init);
}

