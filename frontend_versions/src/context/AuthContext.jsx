import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  GoogleAuthProvider,
  onIdTokenChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { auth, isFirebaseConfigured } from "@/service/firebaseConfig";
import { fetchAuthSession, SESSION_EXPIRED_EVENT } from "@/lib/api";

const AuthContext = createContext(null);
const DEFAULT_CAPABILITIES = Object.freeze({
  unrestrictedRateLimits: false,
  crossUserTripAccess: false,
  debugTools: false,
});

/**
 * Firebase ID tokens expire after 3600 seconds (1 hour).
 * We proactively refresh 5 minutes before expiry so requests never arrive
 * with a stale token.
 */
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Decode the `exp` (expiry) claim from a Firebase JWT without a library.
 * Returns the expiry as a JS timestamp (ms) or null on failure.
 */
function getTokenExpiryMs(idToken) {
  try {
    const payloadBase64 = idToken.split(".")[1];
    if (!payloadBase64) {
      return null;
    }

    const payload = JSON.parse(atob(payloadBase64));
    if (typeof payload.exp === "number") {
      return payload.exp * 1000;
    }
  } catch {
    // Malformed token — caller will skip proactive refresh.
  }

  return null;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [role, setRole] = useState("user");
  const [capabilities, setCapabilities] = useState(DEFAULT_CAPABILITIES);
  const [sessionMetadataLoading, setSessionMetadataLoading] = useState(false);
  const refreshTimerRef = useRef(null);

  // ── Proactive token refresh scheduler ─────────────────────────────────
  const scheduleTokenRefresh = useCallback(async (firebaseUser) => {
    // Clear any previously scheduled refresh.
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    if (!firebaseUser) {
      return;
    }

    try {
      const idToken = await firebaseUser.getIdToken();
      const expiryMs = getTokenExpiryMs(idToken);

      if (!expiryMs) {
        return;
      }

      const refreshAt = expiryMs - TOKEN_REFRESH_BUFFER_MS;
      const delayMs = Math.max(refreshAt - Date.now(), 0);

      console.info("[auth] Scheduling proactive token refresh", {
        expiresIn: `${Math.round((expiryMs - Date.now()) / 1000)}s`,
        refreshIn: `${Math.round(delayMs / 1000)}s`,
      });

      refreshTimerRef.current = setTimeout(async () => {
        try {
          await firebaseUser.getIdToken(true);
          console.info("[auth] Proactive token refresh succeeded");
          // Schedule the next refresh after the new token.
          scheduleTokenRefresh(firebaseUser);
        } catch (error) {
          console.warn("[auth] Proactive token refresh failed", {
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }, delayMs);
    } catch (error) {
      console.warn("[auth] Failed to read token for refresh scheduling", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  // ── Auth state listener (onIdTokenChanged fires on sign-in, sign-out,
  //    AND token refresh — more granular than onAuthStateChanged) ────────
  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return undefined;
    }

    const unsubscribe = onIdTokenChanged(auth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);

      // Clear session-expired flag when a user signs in.
      if (nextUser) {
        setSessionExpired(false);
        scheduleTokenRefresh(nextUser);
      } else {
        // User signed out — clear the refresh timer.
        if (refreshTimerRef.current) {
          clearTimeout(refreshTimerRef.current);
          refreshTimerRef.current = null;
        }
      }
    });

    return () => {
      unsubscribe();
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [scheduleTokenRefresh]);

  // ── Listen for SESSION_EXPIRED_EVENT from the API layer ───────────────
  useEffect(() => {
    function handleSessionExpired(event) {
      console.warn("[auth] Session expired event received", event.detail);
      setSessionExpired(true);
    }

    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    if (!user) {
      setRole("user");
      setCapabilities(DEFAULT_CAPABILITIES);
      setSessionMetadataLoading(false);
      return () => controller.abort();
    }

    async function loadSessionMetadata() {
      setSessionMetadataLoading(true);

      try {
        const session = await fetchAuthSession({
          signal: controller.signal,
        });
        const nextRole = session?.role === "admin" ? "admin" : "user";
        const nextCapabilities = {
          ...DEFAULT_CAPABILITIES,
          ...(session?.capabilities && typeof session.capabilities === "object"
            ? session.capabilities
            : {}),
        };

        console.info("[auth] Loaded backend auth session metadata", {
          uid: session?.user?.uid ?? "",
          email: session?.user?.email ?? "",
          role: nextRole,
          capabilities: nextCapabilities,
        });
        setRole(nextRole);
        setCapabilities(nextCapabilities);
      } catch (error) {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
          return;
        }

        if (error?.details?.requiresReauth) {
          return;
        }

        console.warn("[auth] Failed to load backend auth session metadata", {
          message: error instanceof Error ? error.message : String(error),
        });
        setRole("user");
        setCapabilities(DEFAULT_CAPABILITIES);
      } finally {
        setSessionMetadataLoading(false);
      }
    }

    loadSessionMetadata();

    return () => controller.abort();
  }, [user]);

  const value = useMemo(
    () => ({
      user,
      loading,
      role,
      isAdmin: role === "admin",
      capabilities,
      sessionMetadataLoading,
      isConfigured: isFirebaseConfigured,
      sessionExpired,
      dismissSessionExpired() {
        setSessionExpired(false);
      },
      async signInWithGoogle() {
        if (!auth) {
          throw new Error(
            "Firebase Auth is not configured for this environment."
          );
        }

        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });
        const result = await signInWithPopup(auth, provider);

        // Clear session-expired flag on successful sign-in.
        setSessionExpired(false);
        return result.user;
      },
      async signOut() {
        if (!auth) {
          return;
        }

        await firebaseSignOut(auth);
      },
    }),
    [loading, user, role, capabilities, sessionMetadataLoading, sessionExpired]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider.");
  }

  return context;
}
