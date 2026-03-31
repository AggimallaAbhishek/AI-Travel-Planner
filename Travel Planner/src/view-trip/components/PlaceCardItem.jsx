import React from "react";
import { FaMapMarkerAlt, FaClock, FaExternalLinkAlt } from "react-icons/fa";
import { getPlaceImage } from "@/lib/destinationImages";
import AppImage from "@/components/ui/AppImage";
import { IMAGE_FALLBACKS } from "@/lib/imageManifest";
import { resolveGoogleMapsUrl } from "@/lib/maps";

function PlaceCardItem({ place, destination = "" }) {
  const photoUrl = getPlaceImage(place);
  const mapsUrl = resolveGoogleMapsUrl({
    mapsUrl: place?.mapsUrl ?? place?.googleMapsUri,
    name: place?.placeName,
    destination,
    coordinates: place?.geoCoordinates,
  });
  const hasCoordinates =
    place?.geoCoordinates?.latitude !== null &&
    place?.geoCoordinates?.longitude !== null;

  const handleMapClick = () => {
    console.info("[maps] Opening itinerary place in Google Maps", {
      placeName: place?.placeName ?? "",
      destination,
      hasCoordinates,
      mapsUrl,
    });
  };

  const cardContent = (
    <div className="bg-[var(--voy-surface)] rounded-2xl overflow-hidden shadow-md hover:shadow-xl transition-all duration-300 border border-[var(--voy-border)] group-hover:border-[var(--voy-gold)]">
      <div className="relative h-48 overflow-hidden">
        <AppImage
          src={photoUrl}
          fallbackSrc={IMAGE_FALLBACKS.place}
          alt={place?.placeName || "Travel destination"}
          sizes="(max-width: 560px) 100vw, (max-width: 980px) 50vw, 33vw"
          className="h-full w-full"
          imgClassName="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>

        <div className="absolute bottom-3 left-3 bg-[var(--voy-gold)] text-black text-xs font-medium px-3 py-1 rounded-full flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          <FaExternalLinkAlt size={10} />
          <span>View on Maps</span>
        </div>
      </div>

      <div className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-lg text-[var(--voy-text)] truncate mb-1">
              {place.placeName}
            </h2>
            
            {place.placeDetails && (
              <p className="text-sm text-[var(--voy-text-muted)] mb-3 line-clamp-2">
                {place.placeDetails}
              </p>
            )}
            
            <div className="flex items-center justify-between mt-4">
              {place.travelTime && (
                <div className="flex items-center gap-2 text-sm text-[var(--voy-text-muted)]">
                  <FaClock className="text-[var(--voy-gold)]" />
                  <span>{place.travelTime}</span>
                </div>
              )}
              
              <div className="flex items-center gap-1 text-xs text-[var(--voy-text-faint)]">
                <FaMapMarkerAlt className="text-[var(--voy-gold)]" />
                <span>Explore</span>
              </div>
            </div>
          </div>
        </div>

        {place.category && (
          <div className="mt-3 flex flex-wrap gap-2">
            {place.category.split(",").map((cat, index) => (
              <span 
                key={index}
                className="px-2 py-1 bg-[var(--voy-gold-dim)] text-[var(--voy-gold)] text-xs rounded-full font-medium"
              >
                {cat.trim()}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="group cursor-pointer transform transition-all duration-300 hover:-translate-y-1">
      <a
        href={mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleMapClick}
        className="no-underline text-inherit"
      >
        {cardContent}
      </a>
    </div>
  );
}

export default PlaceCardItem;
