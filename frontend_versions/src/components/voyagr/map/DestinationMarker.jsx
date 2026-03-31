import React from "react";

export default function DestinationMarker({
  destination,
  isActive,
  onHover,
  onMove,
  onLeave,
  onClick,
}) {
  const markerPoint = destination.markerPoint ?? destination.point ?? { x: 0, y: 0 };
  const anchorPoint = destination.anchorPoint ?? markerPoint;
  const leaderX = Number((anchorPoint.x - markerPoint.x).toFixed(2));
  const leaderY = Number((anchorPoint.y - markerPoint.y).toFixed(2));
  const hasLeader = Math.hypot(leaderX, leaderY) > 0.2;

  const handleKeyDown = (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    onClick(destination, event);
  };

  return (
    <g
      className={`voy-map-marker ${isActive ? "active" : ""}`}
      transform={`translate(${markerPoint.x}, ${markerPoint.y})`}
      onMouseEnter={(event) => onHover(destination, event)}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      onFocus={(event) => onHover(destination, event)}
      onBlur={onLeave}
      onClick={(event) => onClick(destination, event)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-haspopup="dialog"
      aria-pressed={isActive}
      aria-label={`View ${destination.name}`}
    >
      {hasLeader ? (
        <>
          <line className="voy-map-marker-leader" x1={leaderX} y1={leaderY} x2="0" y2="0" />
          <circle className="voy-map-marker-anchor" cx={leaderX} cy={leaderY} r="2.2" />
        </>
      ) : null}
      <circle className="voy-map-marker-pulse" r="13" />
      <circle className="voy-map-marker-ring" r="7" />
      <circle className="voy-map-marker-core" r="3.8" />
      {isActive ? (
        <text className="voy-map-marker-label" y="-18" textAnchor="middle">
          {destination.name}
        </text>
      ) : null}
    </g>
  );
}
