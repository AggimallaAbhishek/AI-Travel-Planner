import React, { useEffect, useMemo, useState } from "react";
import { cn } from "@/components/lib/utils";
import { IMAGE_FALLBACKS } from "@/lib/imageManifest";

const UNSPLASH_HOSTS = new Set(["images.unsplash.com", "plus.unsplash.com"]);
const LOREM_FLICKR_HOSTS = new Set(["loremflickr.com"]);
const RESPONSIVE_IMAGE_WIDTHS = [320, 480, 640, 768, 960, 1200, 1440];

function isUnsplashUrl(url) {
  if (typeof url !== "string" || !url.startsWith("http")) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return UNSPLASH_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function buildUnsplashUrl(url, { width, quality }) {
  try {
    const parsed = new URL(url);
    if (!UNSPLASH_HOSTS.has(parsed.hostname)) {
      return url;
    }

    parsed.searchParams.set("auto", "format");
    parsed.searchParams.set("fit", "crop");
    parsed.searchParams.set("q", String(quality));

    if (Number.isFinite(width) && width > 0) {
      parsed.searchParams.set("w", String(Math.round(width)));
    }

    return parsed.toString();
  } catch {
    return url;
  }
}

function isLoremFlickrUrl(url) {
  if (typeof url !== "string" || !url.startsWith("http")) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return LOREM_FLICKR_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function buildLoremFlickrUrl(url, { width }) {
  try {
    const parsed = new URL(url);
    if (!LOREM_FLICKR_HOSTS.has(parsed.hostname)) {
      return url;
    }

    const pathSegments = parsed.pathname.split("/").filter(Boolean);
    if (pathSegments.length < 3) {
      return url;
    }

    const sourceWidth = Number.parseInt(pathSegments[0], 10);
    const sourceHeight = Number.parseInt(pathSegments[1], 10);
    if (
      !Number.isFinite(sourceWidth) ||
      !Number.isFinite(sourceHeight) ||
      sourceWidth <= 0 ||
      sourceHeight <= 0
    ) {
      return url;
    }

    const boundedWidth = Number.isFinite(width) && width > 0
      ? Math.round(width)
      : sourceWidth;
    const ratio = sourceHeight / sourceWidth;
    const boundedHeight = Math.max(200, Math.round(boundedWidth * ratio));

    pathSegments[0] = String(boundedWidth);
    pathSegments[1] = String(boundedHeight);
    parsed.pathname = `/${pathSegments.join("/")}`;
    return parsed.toString();
  } catch {
    return url;
  }
}

export default function AppImage({
  src,
  fallbackSrc = IMAGE_FALLBACKS.scenic,
  alt,
  className,
  imgClassName,
  aspectRatio,
  loading = "lazy",
  decoding = "async",
  sizes,
  quality = 72,
  maxWidth = 1400,
  fetchPriority,
  onLoad,
  onError,
  ...imgProps
}) {
  const primarySrc = src || fallbackSrc || IMAGE_FALLBACKS.scenic;
  const [activeSrc, setActiveSrc] = useState(primarySrc);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasTriedFallback, setHasTriedFallback] = useState(primarySrc === fallbackSrc);

  useEffect(() => {
    const nextPrimarySrc = src || fallbackSrc || IMAGE_FALLBACKS.scenic;
    setActiveSrc(nextPrimarySrc);
    setIsLoaded(false);
    setHasTriedFallback(nextPrimarySrc === fallbackSrc);
  }, [src, fallbackSrc]);

  const wrapperStyle = useMemo(
    () => (aspectRatio ? { aspectRatio } : undefined),
    [aspectRatio]
  );

  const imageSource = useMemo(() => {
    const isUnsplash = isUnsplashUrl(activeSrc);
    const isLoremFlickr = isLoremFlickrUrl(activeSrc);

    if (!isUnsplash && !isLoremFlickr) {
      return {
        src: activeSrc,
        srcSet: undefined,
        sizes: sizes,
      };
    }

    const boundedMaxWidth = Math.max(320, Math.round(maxWidth));
    const widths = RESPONSIVE_IMAGE_WIDTHS.filter((width) => width <= boundedMaxWidth);
    const fallbackWidth = widths.length > 0 ? widths[widths.length - 1] : boundedMaxWidth;

    const buildUrl = isUnsplash
      ? (width) => buildUnsplashUrl(activeSrc, { width, quality })
      : (width) => buildLoremFlickrUrl(activeSrc, { width });

    return {
      src: buildUrl(fallbackWidth),
      srcSet: widths.map((width) => `${buildUrl(width)} ${width}w`).join(", "),
      sizes:
        sizes ??
        "(max-width: 640px) 92vw, (max-width: 1024px) 60vw, (max-width: 1400px) 40vw, 560px",
    };
  }, [activeSrc, maxWidth, quality, sizes]);

  const resolvedFetchPriority = fetchPriority ?? (loading === "eager" ? "high" : "low");

  const handleLoad = (event) => {
    setIsLoaded(true);
    onLoad?.(event);
  };

  const handleError = (event) => {
    if (!hasTriedFallback && fallbackSrc && activeSrc !== fallbackSrc) {
      console.warn("[image] Swapping to fallback image", {
        src: activeSrc,
        fallbackSrc,
      });
      setActiveSrc(fallbackSrc);
      setHasTriedFallback(true);
      return;
    }

    setIsLoaded(true);
    onError?.(event);
  };

  return (
    <div
      className={cn(
        "voy-app-image-wrapper",
        isLoaded ? "is-loaded" : "is-loading",
        className
      )}
      style={wrapperStyle}
    >
      <img
        {...imgProps}
        src={imageSource.src}
        srcSet={imageSource.srcSet}
        alt={alt}
        loading={loading}
        decoding={decoding}
        fetchPriority={resolvedFetchPriority}
        sizes={imageSource.sizes}
        className={cn("voy-app-image", imgClassName)}
        onLoad={handleLoad}
        onError={handleError}
      />
      {!isLoaded ? <span className="voy-app-image-skeleton" aria-hidden="true" /> : null}
    </div>
  );
}
