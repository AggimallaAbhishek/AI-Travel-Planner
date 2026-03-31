import React from "react";
import AppImage from "@/components/ui/AppImage";
import { IMAGE_FALLBACKS } from "@/lib/imageManifest";

export default function DestinationHoverCard({
  destination,
  position,
  anchored = false,
  onViewDetails,
}) {
  if (!destination) {
    return null;
  }

  const style = anchored
    ? undefined
    : {
        left: `${position.x}px`,
        top: `${position.y}px`,
      };

  return (
    <article className={`voy-map-hover-card ${anchored ? "anchored" : ""}`} style={style}>
      <AppImage
        src={destination.image}
        fallbackSrc={IMAGE_FALLBACKS.destination}
        alt={destination.name}
        sizes="280px"
        className="h-[120px] w-full"
        imgClassName="h-full w-full object-cover"
      />
      <div className="voy-map-hover-content">
        <p>{destination.country}</p>
        <h4>{destination.name}</h4>
        <span>{destination.tagline}</span>
        {anchored ? (
          <button type="button" onClick={() => onViewDetails(destination)}>
            View Details
          </button>
        ) : null}
      </div>
    </article>
  );
}
