import React from "react";
import { Link } from "react-router-dom";
import AppImage from "@/components/ui/AppImage";
import { IMAGE_FALLBACKS } from "@/lib/imageManifest";

function ActionLink({ action, className }) {
  if (!action) {
    return null;
  }

  if (action.href) {
    return (
      <a
        href={action.href}
        className={className}
        target={action.external ? "_blank" : undefined}
        rel={action.external ? "noreferrer noopener" : undefined}
      >
        {action.label}
      </a>
    );
  }

  return (
    <Link to={action.to ?? "/"} className={className}>
      {action.label}
    </Link>
  );
}

export default function StaticPageLayout({
  eyebrow,
  title,
  highlight,
  subtitle,
  description,
  image,
  imageAlt,
  actions = [],
  stats = [],
  cards = [],
}) {
  return (
    <section className="voy-static-page">
      <div className="voy-page-shell">
        <div className="voy-static-hero voy-reveal">
          <div className="voy-static-copy">
            {eyebrow ? <span className="voy-static-eyebrow">{eyebrow}</span> : null}
            <h1 className="voy-page-title">
              {title}
              {highlight ? (
                <>
                  {" "}
                  <em>{highlight}</em>
                </>
              ) : null}
            </h1>
            {subtitle ? <p className="voy-page-subtitle">{subtitle}</p> : null}
            {description ? <p className="voy-static-description">{description}</p> : null}

            {actions.length > 0 ? (
              <div className="voy-static-actions">
                {actions.map((action) => (
                  <ActionLink
                    key={action.label}
                    action={action}
                    className={`voy-static-action ${action.variant === "secondary" ? "secondary" : ""}`}
                  />
                ))}
              </div>
            ) : null}

            {stats.length > 0 ? (
              <div className="voy-static-stats">
                {stats.map((item) => (
                  <div key={item.label} className="voy-static-stat">
                    <strong>{item.value}</strong>
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="voy-static-visual-shell">
            <AppImage
              src={image}
              fallbackSrc={IMAGE_FALLBACKS.page}
              alt={imageAlt ?? title}
              className="voy-static-visual"
              imgClassName="voy-static-visual-img"
              aspectRatio="16 / 11"
              sizes="(max-width: 980px) 100vw, 46vw"
              fetchPriority="high"
              loading="eager"
            />
          </div>
        </div>

        {cards.length > 0 ? (
          <div className="voy-static-grid">
            {cards.map((card) => (
              <article key={card.title} className="voy-static-card">
                {card.eyebrow ? <span className="voy-static-card-eyebrow">{card.eyebrow}</span> : null}
                <h2>{card.title}</h2>
                <p>{card.description}</p>
                {card.meta ? <div className="voy-static-card-meta">{card.meta}</div> : null}
                {card.link ? (
                  <ActionLink action={card.link} className="voy-static-card-link" />
                ) : null}
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
