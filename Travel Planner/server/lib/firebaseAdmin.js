import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

export function normalizePrivateKey(value) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  const isWrappedInDoubleQuotes =
    trimmed.startsWith("\"") && trimmed.endsWith("\"") && trimmed.length >= 2;
  const isWrappedInSingleQuotes =
    trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2;
  const unwrapped = isWrappedInDoubleQuotes || isWrappedInSingleQuotes
    ? trimmed.slice(1, -1)
    : trimmed;

  return unwrapped.replace(/\\n/g, "\n");
}

function getCredential() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);

  if (projectId && clientEmail && privateKey) {
    return cert({
      projectId,
      clientEmail,
      privateKey,
    });
  }

  return applicationDefault();
}

export function getFirebaseAdminApp() {
  if (!getApps().length) {
    initializeApp({
      credential: getCredential(),
      projectId: process.env.FIREBASE_PROJECT_ID,
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
