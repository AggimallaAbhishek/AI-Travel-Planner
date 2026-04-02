import React, { useEffect, useMemo, useRef, useState } from "react";
import TypewriterText from "./TypewriterText";
import { HERO_BACKGROUND_IMAGES } from "@/lib/imageManifest";
import { useTheme } from "@/context/ThemeContext";

const HERO_TAGS = [
  { key: "beach", label: "🏖️ Beach" },
  { key: "mountains", label: "🏔️ Mountains" },
  { key: "culture", label: "🏛️ Culture" },
  { key: "adventure", label: "🧗 Adventure" },
  { key: "food", label: "🍜 Food" },
];

const HERO_TITLE_SEGMENTS = [
  { text: "Plan Your " },
  { text: "Perfect", emphasis: true },
  { text: " Journey" },
];

export default function HeroSection({ activeFilter, onFilterSelect, onStartPlanning }) {
  const [parallaxOffset, setParallaxOffset] = useState(0);
  const parallaxRafIdRef = useRef(null);
  const latestParallaxOffsetRef = useRef(0);
  const { theme } = useTheme();
  const [formState, setFormState] = useState({
    destination: "",
    fromDate: "",
    travelers: "2 Travelers",
  });

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setParallaxOffset(0);
      return undefined;
    }

    const updateParallax = () => {
      parallaxRafIdRef.current = null;
      const nextOffset = Math.min(window.scrollY * 0.2, 70);

      if (Math.abs(latestParallaxOffsetRef.current - nextOffset) < 0.45) {
        return;
      }

      latestParallaxOffsetRef.current = nextOffset;
      setParallaxOffset(nextOffset);
    };

    const onScroll = () => {
      if (parallaxRafIdRef.current !== null) {
        return;
      }

      parallaxRafIdRef.current = window.requestAnimationFrame(updateParallax);
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (parallaxRafIdRef.current !== null) {
        window.cancelAnimationFrame(parallaxRafIdRef.current);
        parallaxRafIdRef.current = null;
      }
    };
  }, []);

  const parallaxStyle = useMemo(
    () => ({ transform: `translate3d(0, ${parallaxOffset}px, 0)` }),
    [parallaxOffset]
  );

  const handleStart = () => {
    console.info("[voyagr-hero] Start planning clicked", formState);
    onStartPlanning(formState);
  };
  const activeHeroBackgroundImage =
    theme === "light" ? HERO_BACKGROUND_IMAGES.light : HERO_BACKGROUND_IMAGES.dark;

  return (
    <section id="hero" className="voy-hero">
      <div className="voy-hero-media" aria-hidden="true">
        <div
          className={`voy-hero-parallax active ${theme === "light" ? "light" : ""}`}
          style={{
            ...parallaxStyle,
            backgroundImage: `url(${activeHeroBackgroundImage})`,
          }}
        />
      </div>
      <div className="voy-hero-overlay" />

      <div className="voy-hero-content">
        <div className="voy-hero-eyebrow">Discover the world</div>
        <h1 className="voy-hero-title" aria-label="Plan Your Perfect Journey">
          <TypewriterText segments={HERO_TITLE_SEGMENTS} />
        </h1>
        <p className="voy-hero-subtitle">
          Use AI-assisted planning to move from travel ideas to an actionable trip
          plan in minutes.
        </p>

        <div className="voy-hero-search">
          <label className="voy-search-field">
            <span className="voy-sr-only">Destination</span>
            <span className="voy-field-icon">📍</span>
            <input
              id="voy-hero-destination"
              value={formState.destination}
              onChange={(event) =>
                setFormState((previous) => ({
                  ...previous,
                  destination: event.target.value,
                }))
              }
              placeholder="Where to?"
              aria-label="Destination"
            />
          </label>
          <label className="voy-search-field">
            <span className="voy-sr-only">Departure date</span>
            <span className="voy-field-icon">📅</span>
            <input
              id="voy-hero-from-date"
              type="date"
              value={formState.fromDate}
              onChange={(event) =>
                setFormState((previous) => ({
                  ...previous,
                  fromDate: event.target.value,
                }))
              }
              aria-label="Departure date"
            />
          </label>
          <label className="voy-search-field">
            <span className="voy-sr-only">Number of travelers</span>
            <span className="voy-field-icon">👥</span>
            <select
              id="voy-hero-travelers"
              value={formState.travelers}
              onChange={(event) =>
                setFormState((previous) => ({
                  ...previous,
                  travelers: event.target.value,
                }))
              }
              aria-label="Number of travelers"
            >
              <option>1 Traveler</option>
              <option>2 Travelers</option>
              <option>3-5 Travelers</option>
              <option>6+ Travelers</option>
            </select>
          </label>
          <button type="button" className="voy-btn-search" onClick={handleStart}>
            Start Planning
          </button>
        </div>

        <div className="voy-hero-tags">
          {HERO_TAGS.map((tag) => (
            <button
              key={tag.key}
              type="button"
              className={`voy-hero-tag ${activeFilter === tag.key ? "active" : ""}`}
              onClick={() => onFilterSelect(tag.key)}
            >
              {tag.label}
            </button>
          ))}
        </div>
      </div>

      <div className="voy-scroll-indicator">Scroll</div>

      <div className="voy-hero-stats">
        <div className="voy-hero-stat">
          <span className="voy-stat-label">Countries</span>
        </div>
        <div className="voy-hero-stat">
          <span className="voy-stat-label">Destinations</span>
        </div>
        <div className="voy-hero-stat">
          <span className="voy-stat-label">Happy Travelers</span>
        </div>
        <div className="voy-hero-stat">
          <span className="voy-stat-label">Trips Planned</span>
        </div>
      </div>
    </section>
  );
}
