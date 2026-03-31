import React, { useEffect, useMemo, useState } from "react";
import { VOYAGR_DESTINATIONS } from "./data";
import SectionHeader from "./SectionHeader";
import AppImage from "@/components/ui/AppImage";
import { IMAGE_FALLBACKS } from "@/lib/imageManifest";
import {
  buildDestinationMapsUrl,
  formatDestinationStartingPrice,
  persistVoyagrCurrencyPreference,
  readVoyagrCurrencyPreference,
  VOYAGR_CURRENCY_OPTIONS,
} from "@/lib/voyagrCurrency";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "beach", label: "🏖️ Beach" },
  { id: "mountains", label: "🏔️ Mountains" },
  { id: "culture", label: "🏛️ Culture" },
  { id: "adventure", label: "🧗 Adventure" },
  { id: "food", label: "🍜 Food" },
];

function getFilteredDestinations(activeFilter) {
  if (!activeFilter || activeFilter === "all") {
    return VOYAGR_DESTINATIONS;
  }

  return VOYAGR_DESTINATIONS.filter((destination) =>
    destination.category.includes(activeFilter)
  );
}

export default function DestinationsSection({
  activeFilter,
  onFilterChange,
}) {
  const [savedDestinations, setSavedDestinations] = useState(new Set());
  const [currencyCode, setCurrencyCode] = useState(() => readVoyagrCurrencyPreference());

  const destinations = useMemo(
    () => getFilteredDestinations(activeFilter),
    [activeFilter]
  );

  const toggleSaved = (id) => {
    setSavedDestinations((previous) => {
      const next = new Set(previous);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      console.debug("[voyagr-destinations] saved destinations changed", {
        count: next.size,
      });
      return next;
      });
  };

  const handleCurrencyChange = (event) => {
    const nextCurrency = event.target.value;
    const normalizedCurrencyCode = persistVoyagrCurrencyPreference(nextCurrency);
    console.info("[voyagr-destinations] currency changed", {
      currencyCode: normalizedCurrencyCode,
    });
    setCurrencyCode(normalizedCurrencyCode);
  };

  useEffect(() => {
    persistVoyagrCurrencyPreference(currencyCode);
  }, [currencyCode]);

  return (
    <section id="destinations" className="voy-section voy-destinations">
      <SectionHeader
        eyebrow="Explore"
        title="Top"
        highlight="Destinations"
        subtitle="Handpicked locations loved by travelers worldwide, adapted to your trip goals."
      />

      <div className="voy-dest-toolbar voy-reveal">
        <div className="voy-filter-bar">
          {FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              className={`voy-filter-btn ${activeFilter === filter.id ? "active" : ""}`}
              onClick={() => onFilterChange(filter.id)}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <label className="voy-dest-currency" htmlFor="destination-currency">
          <span>Currency</span>
          <select
            id="destination-currency"
            value={currencyCode}
            onChange={handleCurrencyChange}
          >
            {VOYAGR_CURRENCY_OPTIONS.map((currency) => (
              <option key={currency.value} value={currency.value}>
                {currency.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="voy-dest-grid">
        {destinations.map((destination) => {
          const isSaved = savedDestinations.has(destination.id);
          const mapsUrl = buildDestinationMapsUrl(destination);
          const priceLabel = formatDestinationStartingPrice(
            destination.startingPriceUsd,
            currencyCode
          );

          return (
            <article className="voy-dest-card" key={destination.id}>
              <div className="voy-dest-image-wrap">
                <AppImage
                  src={destination.image}
                  fallbackSrc={IMAGE_FALLBACKS.destination}
                  alt={destination.name}
                  sizes="(max-width: 560px) 100vw, (max-width: 980px) 50vw, (max-width: 1380px) 33vw, 20vw"
                  className="h-full w-full"
                  imgClassName="h-full w-full object-cover"
                />
                <span className="voy-dest-badge">{destination.badge}</span>
                <button
                  type="button"
                  className={`voy-dest-save ${isSaved ? "saved" : ""}`}
                  onClick={() => toggleSaved(destination.id)}
                  aria-label={
                    isSaved
                      ? `Remove ${destination.name} from favorites`
                      : `Save ${destination.name} to favorites`
                  }
                >
                  ♥
                </button>
              </div>

              <div className="voy-dest-body">
                <div className="voy-dest-country">{destination.country}</div>
                <h3 className="voy-dest-name">{destination.name}</h3>
                <p className="voy-dest-description">{destination.description}</p>
                <div className="voy-dest-meta">
                  <div className="voy-dest-rating">
                    <span>★ {destination.rating}</span>
                    <span>({destination.reviews.toLocaleString()})</span>
                  </div>
                  <div className="voy-dest-price">{priceLabel}</div>
                </div>
                <a
                  className="voy-dest-explore"
                  href={mapsUrl}
                  onClick={() =>
                    console.info("[voyagr-destinations] opening destination in Google Maps", {
                      destinationId: destination.id,
                      destination: `${destination.name}, ${destination.country}`,
                      mapsUrl,
                    })
                  }
                >
                  Show in Maps
                </a>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
