function isSafeAppPath(pathname) {
  if (typeof pathname !== "string") {
    return false;
  }

  const trimmedPath = pathname.trim();
  if (!trimmedPath) {
    return false;
  }

  if (!trimmedPath.startsWith("/") || trimmedPath.startsWith("//")) {
    return false;
  }

  return true;
}

export function sanitizeNextPath(rawPath) {
  if (!isSafeAppPath(rawPath)) {
    return "/";
  }

  const trimmedPath = rawPath.trim();

  if (trimmedPath === "/login" || trimmedPath.startsWith("/login?")) {
    return "/";
  }

  return trimmedPath;
}

export function buildLoginPath(nextPath) {
  const safeNextPath = sanitizeNextPath(nextPath);

  if (safeNextPath === "/") {
    return "/login";
  }

  return `/login?next=${encodeURIComponent(safeNextPath)}`;
}
