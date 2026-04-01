import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function normalizeEnvString(value) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function normalizePrivateKey(value) {
  return normalizeEnvString(value)
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function looksLikeBase64(value) {
  return typeof value === "string" && /^[A-Za-z0-9+/=\s]+$/.test(value.trim());
}

function decodeBase64(value) {
  const normalized = normalizeEnvString(value);
  if (!normalized || !looksLikeBase64(normalized)) {
    return "";
  }

  try {
    return Buffer.from(normalized, "base64").toString("utf8");
  } catch (_error) {
    return "";
  }
}

function ensurePemPrivateKey(value) {
  const normalized = normalizePrivateKey(value);
  if (!normalized) {
    return "";
  }

  if (
    normalized.includes("-----BEGIN PRIVATE KEY-----") &&
    normalized.includes("-----END PRIVATE KEY-----")
  ) {
    return normalized;
  }

  const decoded = decodeBase64(normalized);
  if (
    decoded.includes("-----BEGIN PRIVATE KEY-----") &&
    decoded.includes("-----END PRIVATE KEY-----")
  ) {
    return normalizePrivateKey(decoded);
  }

  return normalized;
}

function parseServiceAccountJson(rawValue) {
  const normalized = normalizeEnvString(rawValue);
  if (!normalized) {
    return null;
  }

  try {
    const parsed = JSON.parse(normalized);
    const projectId = normalizeEnvString(parsed.project_id ?? parsed.projectId);
    const clientEmail = normalizeEnvString(parsed.client_email ?? parsed.clientEmail);
    const privateKey = normalizePrivateKey(parsed.private_key ?? parsed.privateKey);

    if (!projectId || !clientEmail || !privateKey) {
      return null;
    }

    return {
      mode: "service_account_json",
      projectId,
      clientEmail,
      privateKey,
    };
  } catch (_error) {
    return null;
  }
}

function parseBase64ServiceAccountJson(rawValue) {
  const decoded = decodeBase64(rawValue);
  if (!decoded) {
    return null;
  }

  return parseServiceAccountJson(decoded);
}

export function resolveFirebaseAdminCredentialConfig(env = process.env) {
  const serviceAccountJson =
    parseServiceAccountJson(env.FIREBASE_SERVICE_ACCOUNT_JSON) ??
    parseServiceAccountJson(env.GOOGLE_SERVICE_ACCOUNT_JSON) ??
    parseBase64ServiceAccountJson(env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64) ??
    parseBase64ServiceAccountJson(env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64);

  if (serviceAccountJson) {
    return serviceAccountJson;
  }

  const projectId = normalizeEnvString(env.FIREBASE_PROJECT_ID);
  const clientEmail = normalizeEnvString(env.FIREBASE_CLIENT_EMAIL);
  const privateKey = ensurePemPrivateKey(
    env.FIREBASE_PRIVATE_KEY_BASE64 || env.FIREBASE_PRIVATE_KEY
  );
  const providedFieldCount = [projectId, clientEmail, privateKey].filter(Boolean).length;

  if (providedFieldCount === 0) {
    return {
      mode: "application_default",
      projectId: "",
      clientEmail: "",
      privateKey: "",
    };
  }

  if (providedFieldCount < 3) {
    const error = new Error(
      "Incomplete Firebase Admin credentials. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY together."
    );
    error.code = "app/invalid-credential";
    throw error;
  }

  if (
    !privateKey.includes("-----BEGIN PRIVATE KEY-----") ||
    !privateKey.includes("-----END PRIVATE KEY-----")
  ) {
    const error = new Error(
      "Invalid Firebase Admin private key format. Prefer FIREBASE_SERVICE_ACCOUNT_JSON or ensure FIREBASE_PRIVATE_KEY contains a full PEM key with newline escapes."
    );
    error.code = "app/invalid-credential";
    throw error;
  }

  return {
    mode: "service_account_env",
    projectId,
    clientEmail,
    privateKey,
  };
}

function getCredentialOptions(env = process.env) {
  const config = resolveFirebaseAdminCredentialConfig(env);

  if (config.mode === "application_default") {
    return {
      credential: applicationDefault(),
      projectId: normalizeEnvString(env.FIREBASE_PROJECT_ID),
      mode: config.mode,
    };
  }

  return {
    credential: cert({
      projectId: config.projectId,
      clientEmail: config.clientEmail,
      privateKey: config.privateKey,
    }),
    projectId: config.projectId,
    mode: config.mode,
  };
}

export function getFirebaseAdminApp() {
  if (!getApps().length) {
    const { credential, projectId, mode } = getCredentialOptions();
    console.info("[firebase-admin] Initializing Firebase Admin app", {
      credentialMode: mode,
      hasProjectId: Boolean(projectId),
      hasClientEmail: Boolean(process.env.FIREBASE_CLIENT_EMAIL || process.env.FIREBASE_SERVICE_ACCOUNT_JSON),
    });

    initializeApp({
      credential,
      ...(projectId
        ? {
            projectId,
          }
        : {}),
    });
  }

  return getApps()[0];
}

export function getAdminDb() {
  return getFirestore(getFirebaseAdminApp());
}

export function getAdminAuth() {
  return getAuth(getFirebaseAdminApp());
}
