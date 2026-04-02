import React, { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { FcGoogle } from "react-icons/fc";
import { toast } from "react-toastify";

/**
 * Inline re-auth modal that appears when the API layer detects a true
 * session expiry. The user can sign in again without losing page context.
 */
export default function SessionExpiredModal() {
  const { sessionExpired, dismissSessionExpired, signInWithGoogle } = useAuth();
  const [signingIn, setSigningIn] = useState(false);

  if (!sessionExpired) {
    return null;
  }

  const handleSignIn = async () => {
    setSigningIn(true);

    try {
      await signInWithGoogle();
      toast.success("Session restored. You can continue where you left off.");
    } catch (error) {
      console.error("[session-modal] Re-auth failed", error);
      toast.error(error.message ?? "Unable to sign in right now.");
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <div className="voy-session-overlay" role="dialog" aria-modal="true" aria-label="Session expired">
      <div className="voy-session-card">
        <div className="voy-session-icon" aria-hidden="true">
          <svg viewBox="0 0 48 48" fill="none" width="48" height="48">
            <circle cx="24" cy="24" r="22" stroke="currentColor" strokeWidth="2" strokeOpacity="0.3" />
            <path
              d="M24 14v12"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            <circle cx="24" cy="32" r="1.5" fill="currentColor" />
          </svg>
        </div>

        <h2>Session Expired</h2>
        <p>
          Your authentication session has expired. Sign in again to continue
          where you left off — no progress will be lost.
        </p>

        <button
          type="button"
          className="voy-session-google-btn"
          disabled={signingIn}
          onClick={handleSignIn}
          aria-busy={signingIn}
        >
          <FcGoogle className="h-5 w-5" />
          {signingIn ? "Signing In..." : "Continue With Google"}
        </button>

        <button
          type="button"
          className="voy-session-dismiss"
          onClick={dismissSessionExpired}
          disabled={signingIn}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
