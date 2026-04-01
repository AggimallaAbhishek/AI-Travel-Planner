import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const viteEnv = import.meta.env ?? {};

const firebaseConfig = {
  apiKey: viteEnv.VITE_FIREBASE_API_KEY ?? "",
  authDomain: viteEnv.VITE_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: viteEnv.VITE_FIREBASE_PROJECT_ID ?? "",
  storageBucket: viteEnv.VITE_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: viteEnv.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: viteEnv.VITE_FIREBASE_APP_ID ?? "",
};

export const isFirebaseConfigured = [
  firebaseConfig.apiKey,
  firebaseConfig.authDomain,
  firebaseConfig.projectId,
  firebaseConfig.appId,
].every(Boolean);

export const app = isFirebaseConfigured
  ? getApps().length
    ? getApp()
    : initializeApp(firebaseConfig)
  : null;

export const auth = app ? getAuth(app) : null;
