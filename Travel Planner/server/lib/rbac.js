const REQUIRED_ADMIN_EMAIL = "aggimallaabhishek@gmail.com";

export const USER_ROLE = "user";
export const ADMIN_ROLE = "admin";

const DEFAULT_CAPABILITIES = Object.freeze({
  unrestrictedRateLimits: false,
  crossUserTripAccess: false,
  debugTools: false,
});

const ADMIN_CAPABILITIES = Object.freeze({
  unrestrictedRateLimits: true,
  crossUserTripAccess: true,
  debugTools: true,
});

export function normalizeEmail(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().toLowerCase();
}

export function parseAdminEmails(value) {
  return String(value ?? "")
    .split(",")
    .map((entry) => normalizeEmail(entry))
    .filter(Boolean);
}

export function resolveAdminEmailAllowlist(rawAdminEmails = process.env.ADMIN_EMAILS) {
  const allowlist = new Set(parseAdminEmails(rawAdminEmails));
  allowlist.add(normalizeEmail(REQUIRED_ADMIN_EMAIL));
  return allowlist;
}

export function isAdminEmail(email, rawAdminEmails = process.env.ADMIN_EMAILS) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return false;
  }

  return resolveAdminEmailAllowlist(rawAdminEmails).has(normalizedEmail);
}

export function resolveUserRoleByEmail(email, rawAdminEmails = process.env.ADMIN_EMAILS) {
  return isAdminEmail(email, rawAdminEmails) ? ADMIN_ROLE : USER_ROLE;
}

export function resolveRoleCapabilities(role) {
  return role === ADMIN_ROLE
    ? { ...ADMIN_CAPABILITIES }
    : { ...DEFAULT_CAPABILITIES };
}

export function buildAuthContextFromToken(
  decodedToken = {},
  { rawAdminEmails = process.env.ADMIN_EMAILS } = {}
) {
  const uid = String(decodedToken?.uid ?? "").trim();
  const email = normalizeEmail(decodedToken?.email);
  const displayName = String(
    decodedToken?.name ?? decodedToken?.displayName ?? ""
  ).trim();
  const role = resolveUserRoleByEmail(email, rawAdminEmails);
  const isAdmin = role === ADMIN_ROLE;
  const capabilities = resolveRoleCapabilities(role);

  return {
    uid,
    email,
    displayName,
    role,
    isAdmin,
    capabilities,
  };
}

export function attachAuthContextToRequest(req, decodedToken = {}) {
  const authContext = buildAuthContextFromToken(decodedToken);
  req.authContext = authContext;
  req.user = {
    ...decodedToken,
    role: authContext.role,
    isAdmin: authContext.isAdmin,
    capabilities: authContext.capabilities,
  };

  return authContext;
}

export function logAdminAction(req, event = "request") {
  const authContext = req?.authContext;
  if (!authContext?.isAdmin) {
    return;
  }

  console.info("[admin] Action", {
    event,
    method: req?.method ?? "",
    path: req?.originalUrl ?? req?.path ?? "",
    uid: authContext.uid,
    email: authContext.email,
    role: authContext.role,
    traceId: req?.traceId ?? null,
  });
}
