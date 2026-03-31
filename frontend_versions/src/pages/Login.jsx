import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FcGoogle } from "react-icons/fc";
import { toast } from "react-toastify";
import { useAuth } from "@/context/AuthContext";
import { sanitizeNextPath } from "@/lib/authRedirect";
import { LOGIN_SLIDES } from "@/lib/imageManifest";

const TAB_COPY = {
  login: {
    title: "Welcome Back, Explorer",
    subtitle:
      "Sign in to continue building itineraries, saving routes, and tracking your travel plans.",
    cta: "Continue With Google",
    hint: "No password typing needed. Use your Google account for secure access.",
  },
  register: {
    title: "Create Your Voyager Account",
    subtitle:
      "Set up your traveler profile and keep every destination, budget plan, and itinerary in one place.",
    cta: "Create Account With Google",
    hint: "Registration is powered by Google sign-in for a faster secure onboarding.",
  },
};

export default function Login() {
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState("login");
  const [activeSlide, setActiveSlide] = useState(0);
  const [typedQuote, setTypedQuote] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const { user, loading, isConfigured, signInWithGoogle } = useAuth();
  const navigate = useNavigate();

  const nextPath = useMemo(
    () => sanitizeNextPath(searchParams.get("next") ?? "/"),
    [searchParams]
  );
  const visibleSlideIndexes = useMemo(() => {
    const nextSlide = (activeSlide + 1) % LOGIN_SLIDES.length;
    return new Set([activeSlide, nextSlide]);
  }, [activeSlide]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setActiveSlide((previousSlide) => (previousSlide + 1) % LOGIN_SLIDES.length);
    }, 6200);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const activeQuote = LOGIN_SLIDES[activeSlide]?.quote ?? "";
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTypedQuote(activeQuote);
      return undefined;
    }

    let pointer = 0;
    setTypedQuote("");

    const timerId = window.setInterval(() => {
      pointer += 1;
      setTypedQuote(activeQuote.slice(0, pointer));

      if (pointer >= activeQuote.length) {
        window.clearInterval(timerId);
      }
    }, 24);

    return () => window.clearInterval(timerId);
  }, [activeSlide]);

  useEffect(() => {
    if (loading || !user) {
      return;
    }

    console.info("[login] User already authenticated, redirecting", { nextPath });
    navigate(nextPath, { replace: true });
  }, [loading, navigate, nextPath, user]);

  const handleGoogleSignIn = async () => {
    if (!isConfigured) {
      toast.error("Firebase Auth is not configured for this environment.");
      return;
    }

    setSigningIn(true);

    try {
      console.info("[login] Attempting Google sign-in", {
        activeTab,
        nextPath,
      });
      await signInWithGoogle();
      toast.success("Signed in successfully.");
      navigate(nextPath, { replace: true });
    } catch (error) {
      console.error("[login] Google sign-in failed", error);
      toast.error(error.message ?? "Unable to sign in right now.");
    } finally {
      setSigningIn(false);
    }
  };

  const content = TAB_COPY[activeTab];
  const activeSlideItem = LOGIN_SLIDES[activeSlide];

  return (
    <section className="voy-login-page">
      <div className="voy-login-shell">
        <aside className="voy-login-left">
          {LOGIN_SLIDES.map((slide, index) =>
            visibleSlideIndexes.has(index) ? (
              <div
                key={slide.image}
                className={`voy-login-slide ${index === activeSlide ? "active" : ""}`}
                style={{ backgroundImage: `url(${slide.image})` }}
              />
            ) : null
          )}

          <div className="voy-login-left-overlay" />
          <div className="voy-login-left-grain" />

          <div className="voy-login-brand">
            <Link to="/" className="voy-login-logo">
              Voy<span>agr</span>
            </Link>
            <p>Journey design studio for AI-first travelers.</p>
          </div>

          <div className="voy-login-quote-wrap">
            <p className="voy-login-quote">
              {typedQuote}
              <span className="voy-login-cursor" aria-hidden="true" />
            </p>
            <p className="voy-login-destination">{activeSlideItem?.destination}</p>
            <div className="voy-login-dots">
              {LOGIN_SLIDES.map((_, index) => (
                <button
                  key={index}
                  type="button"
                  className={index === activeSlide ? "active" : ""}
                  aria-label={`Show slide ${index + 1}`}
                  onClick={() => setActiveSlide(index)}
                />
              ))}
            </div>
          </div>
        </aside>

        <main className="voy-login-right">
          <div className="voy-login-card">
            <div className="voy-login-compass" aria-hidden="true">
              <svg viewBox="0 0 80 80" fill="none">
                <circle cx="40" cy="40" r="37" stroke="currentColor" strokeOpacity="0.45" />
                <circle cx="40" cy="40" r="24" stroke="currentColor" strokeOpacity="0.25" />
                <path
                  d="M40 18 49 40 40 62 31 40 40 18Z"
                  fill="currentColor"
                  fillOpacity="0.8"
                />
                <circle cx="40" cy="40" r="4.6" fill="white" />
              </svg>
            </div>

            <div className="voy-login-tabs" role="tablist" aria-label="Authentication mode">
              <span
                className="voy-login-tab-slider"
                style={{ transform: activeTab === "login" ? "translateX(0%)" : "translateX(100%)" }}
              />
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "login"}
                className={activeTab === "login" ? "active" : ""}
                onClick={() => setActiveTab("login")}
              >
                Sign In
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "register"}
                className={activeTab === "register" ? "active" : ""}
                onClick={() => setActiveTab("register")}
              >
                Register
              </button>
            </div>

            <h1>{content.title}</h1>
            <p className="voy-login-subtitle">{content.subtitle}</p>

            <div className="voy-login-social-row">
              <Button
                type="button"
                disabled={loading || signingIn || !isConfigured}
                onClick={handleGoogleSignIn}
                className="voy-login-google-btn"
                aria-busy={signingIn}
              >
                <FcGoogle className="h-5 w-5" />
                {signingIn ? "Signing In..." : content.cta}
              </Button>
            </div>

            <div className="voy-login-divider">Secure OAuth only</div>

            <p className="voy-login-status" aria-live="polite">
              {signingIn
                ? "Authenticating with Google..."
                : loading
                  ? "Checking current session..."
                  : "Ready to continue securely."}
            </p>

            <p className="voy-login-hint">{content.hint}</p>

            {!isConfigured ? (
              <p className="voy-login-warning">
                Firebase configuration is missing. Update your environment variables before signing
                in.
              </p>
            ) : null}

            <div className="voy-login-footer">
              <Link to="/">← Back to homepage</Link>
              <span>Redirect after sign-in: {nextPath}</span>
            </div>
          </div>
        </main>
      </div>
    </section>
  );
}
