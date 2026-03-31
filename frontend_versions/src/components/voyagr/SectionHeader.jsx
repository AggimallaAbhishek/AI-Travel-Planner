import React from "react";

export default function SectionHeader({ eyebrow, title, highlight, subtitle }) {
  return (
    <div className="voy-section-header voy-reveal">
      <div className="voy-section-eyebrow">{eyebrow}</div>
      <h2 className="voy-section-title">
        {title} <em>{highlight}</em>
      </h2>
      <p className="voy-section-subtitle">{subtitle}</p>
    </div>
  );
}
