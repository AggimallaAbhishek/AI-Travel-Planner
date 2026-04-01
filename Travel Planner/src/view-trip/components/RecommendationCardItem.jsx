import React from "react";
import {
  FaArrowRight,
  FaHotel,
  FaMapMarkerAlt,
  FaStar,
  FaTag,
  FaUtensils,
} from "react-icons/fa";
import AppImage from "@/components/ui/AppImage";
import { getHotelImage, getRestaurantImage } from "@/lib/destinationImages";
import { IMAGE_FALLBACKS } from "@/lib/imageManifest";

function hasCoordinates(coordinates = {}) {
  const latitude = Number.parseFloat(coordinates?.latitude);
  const longitude = Number.parseFloat(coordinates?.longitude);

  return Number.isFinite(latitude) && Number.isFinite(longitude);
}

function resolveMapsUrl(item = {}) {
  if (typeof item.mapsUrl === "string" && /^https?:\/\//i.test(item.mapsUrl)) {
    return item.mapsUrl;
  }

  if (hasCoordinates(item.geoCoordinates)) {
    const latitude = Number.parseFloat(item.geoCoordinates.latitude);
    const longitude = Number.parseFloat(item.geoCoordinates.longitude);
    return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
  }

  const query = [item.name, item.location].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function RecommendationCardItem({ item, type = "hotel", index = 0 }) {
  const isHotel = type === "hotel";
  const photoUrl = isHotel ? getHotelImage(item) : getRestaurantImage(item);
  const fallbackSrc = isHotel ? IMAGE_FALLBACKS.hotel : IMAGE_FALLBACKS.restaurant;
  const labelIcon = isHotel ? <FaHotel /> : <FaUtensils />;
  const labelText = isHotel ? "Stay" : "Dining";
  const mapsUrl = resolveMapsUrl(item);
  const ratingText =
    typeof item.rating === "number" ? item.rating.toFixed(1) : String(item.rating || "");
  const shouldEagerLoad = index < 3;

  return (
    <article className="group overflow-hidden rounded-2xl border border-[var(--voy-border)] bg-[var(--voy-surface)] shadow-md transition-all duration-300 hover:-translate-y-1 hover:shadow-xl">
      <div className="relative h-52 overflow-hidden">
        <AppImage
          src={photoUrl}
          fallbackSrc={fallbackSrc}
          alt={
            item.name || (isHotel ? "Hotel recommendation" : "Restaurant recommendation")
          }
          sizes="(max-width: 560px) 100vw, (max-width: 980px) 50vw, 33vw"
          loading={shouldEagerLoad ? "eager" : "lazy"}
          fetchPriority={shouldEagerLoad ? "high" : "low"}
          className="h-full w-full"
          imgClassName="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

        <div className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-full bg-black/55 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
          {labelIcon}
          <span>{labelText}</span>
        </div>

        {ratingText ? (
          <div className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-full bg-[var(--voy-gold)] px-3 py-1 text-xs font-semibold text-black shadow-md">
            <FaStar />
            <span>{ratingText}</span>
          </div>
        ) : null}
      </div>

      <div className="space-y-4 p-5">
        <div>
          <h3 className="text-xl font-semibold text-[var(--voy-text)]">
            {item.name || (isHotel ? "Recommended Hotel" : "Recommended Restaurant")}
          </h3>
          <p className="mt-2 flex items-start gap-2 text-sm text-[var(--voy-text-muted)]">
            <FaMapMarkerAlt className="mt-0.5 shrink-0 text-[var(--voy-gold)]" />
            <span>{item.location || "Location details unavailable"}</span>
          </p>
        </div>

        <p className="min-h-[4.5rem] text-sm leading-6 text-[var(--voy-text-muted)] line-clamp-3">
          {item.description ||
            `A handpicked ${isHotel ? "stay" : "dining"} option for this destination.`}
        </p>

        {item.priceLabel ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-[var(--voy-gold-dim)] px-3 py-1 text-xs font-medium text-[var(--voy-gold)]">
            <FaTag />
            <span>{item.priceLabel}</span>
          </span>
        ) : null}

        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-sm font-medium text-[var(--voy-text)] transition-colors hover:text-[var(--voy-gold)]"
        >
          <span>Open in Maps</span>
          <FaArrowRight className="transition-transform duration-300 group-hover:translate-x-1" />
        </a>
      </div>
    </article>
  );
}

export default RecommendationCardItem;
