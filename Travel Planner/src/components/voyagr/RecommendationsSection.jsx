import React from "react";
import { VOYAGR_RESTAURANTS } from "./data";
import SectionHeader from "./SectionHeader";
import AppImage from "@/components/ui/AppImage";
import { IMAGE_FALLBACKS } from "@/lib/imageManifest";

export default function RecommendationsSection({ onPlanFromRecommendation }) {
  return (
    <section id="restaurants" className="voy-section voy-recommendations">
      <SectionHeader
        eyebrow="Taste"
        title="Best"
        highlight="Restaurants"
        subtitle="Curated dining stops from the mock travel catalog, designed to add food-first planning to the journey."
      />

      <div className="voy-rec-summary voy-reveal">
        <span>{VOYAGR_RESTAURANTS.length} curated dining spots</span>
        <span>5-column layout on wide screens</span>
        <span>Ratings, locations, and cuisine built into every card</span>
      </div>

      <div className="voy-rec-grid">
        {VOYAGR_RESTAURANTS.map((item) => (
          <article key={item.id} className="voy-rec-card">
            <div className="voy-rec-image-wrap">
              <AppImage
                src={item.image}
                fallbackSrc={IMAGE_FALLBACKS.restaurant}
                alt={item.name}
                sizes="(max-width: 560px) 100vw, (max-width: 980px) 50vw, (max-width: 1380px) 33vw, 20vw"
                className="h-full w-full"
                imgClassName="h-full w-full object-cover"
              />
            </div>
            <div className="voy-rec-body">
              <div className="voy-rec-category">{item.cuisine}</div>
              <h3>{item.name}</h3>
              <p className="voy-rec-description">{item.description}</p>
              <div className="voy-rec-meta">
                <span className="voy-rec-location">{item.location}</span>
                <span className="voy-rec-price">{item.price}</span>
              </div>
              <div className="voy-rec-footer">
                <span className="voy-rec-rating">★ {item.rating.toFixed(1)}</span>
                <span>Dining shortlist</span>
              </div>
              <button
                type="button"
                className="voy-rec-action"
                onClick={() => onPlanFromRecommendation(item.location)}
              >
                Plan Food Stop
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
