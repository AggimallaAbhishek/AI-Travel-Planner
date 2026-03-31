import React, { useEffect, useMemo, useRef, useState } from "react";
import TypewriterText from "./TypewriterText";
import { HERO_BACKGROUND_IMAGES } from "@/lib/imageManifest";
import { useTheme } from "@/context/ThemeContext";
import { getDestinationSuggestions } from "@/lib/destinationAutocomplete";
import { Search } from "lucide-react";

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
  const [showDestinationSuggestions, setShowDestinationSuggestions] = useState(false);
  const [activeDestinationSuggestionIndex, setActiveDestinationSuggestionIndex] =
    useState(-1);
  const [formState, setFormState] = useState({
    destination: "",
    fromDate: "",
    travelers: "2 Travelers",
  });
  const destinationSuggestions = useMemo(
    () => getDestinationSuggestions(formState.destination, { limit: 6 }),
    [formState.destination]
  );
  const destinationListId = "voy-hero-destination-listbox";
  const hasDestinationQuery = Boolean(formState.destination.trim());
  const hasDestinationSuggestions = destinationSuggestions.length > 0;
  const shouldShowDestinationPanel =
    showDestinationSuggestions && hasDestinationQuery;

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

  const handleDestinationChange = (value) => {
    setFormState((previous) => ({
      ...previous,
      destination: value,
    }));
    setShowDestinationSuggestions(Boolean(String(value).trim()));
    setActiveDestinationSuggestionIndex(-1);
  };

  const applyDestinationSuggestion = (suggestionLabel) => {
    setFormState((previous) => ({
      ...previous,
      destination: suggestionLabel,
    }));
    setShowDestinationSuggestions(false);
    setActiveDestinationSuggestionIndex(-1);
    console.info("[voyagr-hero] Destination suggestion selected", {
      destination: suggestionLabel,
    });
  };

  const handleStart = () => {
    const payload = {
      ...formState,
      destination: formState.destination.trim(),
    };

    setShowDestinationSuggestions(false);
    setActiveDestinationSuggestionIndex(-1);
    console.info("[voyagr-hero] Start planning clicked", payload);
    onStartPlanning(payload);
  };

  const handleDestinationKeyDown = (event) => {
    if (event.key === "Escape") {
      setShowDestinationSuggestions(false);
      setActiveDestinationSuggestionIndex(-1);
      return;
    }

    if (!destinationSuggestions.length) {
      if (event.key === "Enter") {
        event.preventDefault();
        handleStart();
      }

      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setShowDestinationSuggestions(true);
      setActiveDestinationSuggestionIndex((previousIndex) =>
        previousIndex >= destinationSuggestions.length - 1 ? 0 : previousIndex + 1
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setShowDestinationSuggestions(true);
      setActiveDestinationSuggestionIndex((previousIndex) =>
        previousIndex <= 0
          ? destinationSuggestions.length - 1
          : previousIndex - 1
      );
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();

      if (activeDestinationSuggestionIndex >= 0) {
        applyDestinationSuggestion(
          destinationSuggestions[activeDestinationSuggestionIndex].label
        );
        return;
      }

      handleStart();
    }
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

        <div
          className={`voy-hero-search ${shouldShowDestinationPanel ? "is-searching" : ""}`}
        >
          <div
            className={`voy-search-field-wrap voy-search-field-wrap--autocomplete ${
              shouldShowDestinationPanel ? "is-open" : ""
            }`}
          >
            <label
              className="voy-search-field voy-search-field--destination"
              htmlFor="voy-hero-destination"
            >
              <span className="voy-sr-only">Destination</span>
              <Search size={18} className="voy-field-icon voy-field-icon-search" />
              <input
                id="voy-hero-destination"
                value={formState.destination}
                onChange={(event) => handleDestinationChange(event.target.value)}
                onKeyDown={handleDestinationKeyDown}
                onFocus={() => {
                  if (formState.destination.trim()) {
                    setShowDestinationSuggestions(true);
                  }
                }}
                onBlur={() => {
                  window.setTimeout(() => {
                    setShowDestinationSuggestions(false);
                    setActiveDestinationSuggestionIndex(-1);
                  }, 100);
                }}
                placeholder="Where to?"
                aria-label="Destination"
                aria-autocomplete="list"
                aria-controls={hasDestinationSuggestions ? destinationListId : undefined}
                aria-expanded={shouldShowDestinationPanel}
                aria-activedescendant={
                  hasDestinationSuggestions && activeDestinationSuggestionIndex >= 0
                    ? `${destinationListId}-${activeDestinationSuggestionIndex}`
                    : undefined
                }
                autoComplete="off"
              />
            </label>

            {shouldShowDestinationPanel ? (
              <div
                className="voy-hero-search-panel"
                role="group"
                aria-label="Destination suggestions"
              >
                <button
                  type="button"
                  className="voy-hero-search-query"
                  onMouseDown={(mouseEvent) => {
                    mouseEvent.preventDefault();
                    handleStart();
                  }}
                >
                  <Search size={18} />
                  <span>Search places for "{formState.destination.trim()}"</span>
                </button>

                {hasDestinationSuggestions ? (
                  <div
                    id={destinationListId}
                    role="listbox"
                    className="voy-hero-search-options"
                    aria-label="Matching destinations"
                  >
                    {destinationSuggestions.map((suggestion, index) => {
                      const isActive = index === activeDestinationSuggestionIndex;

                      return (
                        <div
                          id={`${destinationListId}-${index}`}
                          key={suggestion.label}
                          role="option"
                          aria-selected={isActive}
                          className="voy-hero-search-option-wrap"
                        >
                          <button
                            type="button"
                            className={`voy-hero-search-option ${
                              isActive ? "active" : ""
                            }`}
                            onMouseDown={(mouseEvent) => {
                              mouseEvent.preventDefault();
                              applyDestinationSuggestion(suggestion.label);
                            }}
                            onMouseEnter={() =>
                              setActiveDestinationSuggestionIndex(index)
                            }
                          >
                            <span className="voy-hero-search-option-copy">
                              <span className="voy-hero-search-option-primary">
                                {suggestion.name}
                              </span>
                              {suggestion.country ? (
                                <span className="voy-hero-search-option-secondary">
                                  {suggestion.country}
                                </span>
                              ) : null}
                            </span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="voy-hero-search-empty">
                    Press Enter to search places for "{formState.destination.trim()}".
                  </div>
                )}
              </div>
            ) : null}
          </div>
          <label className="voy-search-field voy-search-field--date">
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
          <label className="voy-search-field voy-search-field--travelers">
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
          <span className="voy-stat-number">180</span>
          <span className="voy-stat-label">Countries</span>
        </div>
        <div className="voy-hero-stat">
          <span className="voy-stat-number">12.4k</span>
          <span className="voy-stat-label">Destinations</span>
        </div>
        <div className="voy-hero-stat">
          <span className="voy-stat-number">98%</span>
          <span className="voy-stat-label">Happy Travelers</span>
        </div>
        <div className="voy-hero-stat">
          <span className="voy-stat-number">50k+</span>
          <span className="voy-stat-label">Trips Planned</span>
        </div>
      </div>
    </section>
  );
}
