import React, { useEffect, useMemo, useState } from "react";
import {
  getTypewriterCharacterCount,
  getVisibleTypewriterSegments,
} from "@/lib/typewriter";

export default function TypewriterText({
  segments,
  speed = 72,
  startDelay = 160,
  className = "",
}) {
  const totalCharacters = useMemo(
    () => getTypewriterCharacterCount(segments),
    [segments]
  );
  const [typedCharacters, setTypedCharacters] = useState(0);

  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let typeInterval;

    if (prefersReducedMotion) {
      setTypedCharacters(totalCharacters);
      return undefined;
    }

    setTypedCharacters(0);

    const startTimer = window.setTimeout(() => {
      typeInterval = window.setInterval(() => {
        setTypedCharacters((currentValue) => {
          if (currentValue >= totalCharacters) {
            window.clearInterval(typeInterval);
            return totalCharacters;
          }

          return currentValue + 1;
        });
      }, speed);
    }, startDelay);

    return () => {
      window.clearTimeout(startTimer);
      window.clearInterval(typeInterval);
    };
  }, [speed, startDelay, totalCharacters]);

  const visibleSegments = useMemo(
    () => getVisibleTypewriterSegments(segments, typedCharacters),
    [segments, typedCharacters]
  );

  return (
    <span className={`voy-typewriter ${className}`.trim()}>
      {visibleSegments.map((segment, index) => {
        if (!segment.text) {
          return null;
        }

        return segment.emphasis ? (
          <em key={`${segment.text}-${index}`}>{segment.text}</em>
        ) : (
          <span key={`${segment.text}-${index}`}>{segment.text}</span>
        );
      })}
      <span className="voy-typewriter-cursor" aria-hidden="true">
        |
      </span>
    </span>
  );
}
