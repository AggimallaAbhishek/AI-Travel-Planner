import React from "react";
import { Button } from "@/components/ui/button";
import RecommendationCardItem from "./RecommendationCardItem";

function LoadingCards() {
  return (
    <div className="grid gap-6 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
      {[1, 2, 3].map((item) => (
        <div
          key={item}
          className="overflow-hidden rounded-2xl border border-[var(--voy-border)] bg-[var(--voy-surface)] shadow-md"
        >
          <div className="h-52 animate-pulse bg-[var(--voy-bg2)]" />
          <div className="space-y-3 p-5">
            <div className="h-6 w-2/3 animate-pulse rounded bg-[var(--voy-bg2)]" />
            <div className="h-4 w-5/6 animate-pulse rounded bg-[var(--voy-bg2)]" />
            <div className="h-4 w-full animate-pulse rounded bg-[var(--voy-bg2)]" />
            <div className="h-4 w-4/5 animate-pulse rounded bg-[var(--voy-bg2)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

function RecommendationGridSection({
  title,
  subtitle,
  items = [],
  isLoading = false,
  errorMessage = "",
  emptyTitle,
  emptyDescription,
  type = "hotel",
  destination = "",
  note = "",
  onRetry,
}) {
  return (
    <section className="relative mt-10 w-full px-0 py-8 md:px-2" aria-live="polite">
      <div className="relative mx-auto max-w-7xl rounded-2xl border border-[var(--voy-border)] bg-[var(--voy-surface)] p-8 shadow-lg">
        <div className="mb-10 text-center">
          <h2 className="text-3xl font-semibold text-[var(--voy-text)] md:text-4xl">
            {title}
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-md text-[var(--voy-text-muted)]">
            {subtitle}
          </p>
          {note ? (
            <div className="mx-auto mt-5 max-w-3xl rounded-full border border-[var(--voy-border)] bg-[var(--voy-surface2)] px-4 py-2 text-sm text-[var(--voy-text-muted)]">
              {note}
            </div>
          ) : null}
        </div>

        {isLoading ? <LoadingCards /> : null}

        {!isLoading && errorMessage ? (
          <div className="rounded-2xl border border-[var(--voy-border)] bg-[var(--voy-surface2)] px-6 py-10 text-center">
            <h3 className="text-2xl font-semibold text-[var(--voy-text)]">
              Unable to load {type === "hotel" ? "hotels" : "restaurants"}
            </h3>
            <p className="mx-auto mt-3 max-w-xl text-[var(--voy-text-muted)]">
              {errorMessage}
            </p>
            {onRetry ? (
              <Button className="voy-create-primary mt-6" onClick={onRetry}>
                Try Again
              </Button>
            ) : null}
          </div>
        ) : null}

        {!isLoading && !errorMessage && items.length > 0 ? (
          <div className="grid gap-6 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {items.map((item, index) => (
              <RecommendationCardItem
                key={`${type}-${item.name}-${item.location}`}
                item={item}
                type={type}
                index={index}
              />
            ))}
          </div>
        ) : null}

        {!isLoading && !errorMessage && items.length === 0 ? (
          <div className="rounded-2xl border border-[var(--voy-border)] bg-[var(--voy-surface2)] px-6 py-12 text-center shadow-sm">
            <h3 className="text-2xl font-semibold text-[var(--voy-text)]">
              {emptyTitle}
            </h3>
            <p className="mx-auto mt-3 max-w-xl text-[var(--voy-text-muted)]">
              {emptyDescription}
            </p>
            {destination ? (
              <p className="mt-2 text-sm text-[var(--voy-text-faint)]">
                Current destination: {destination}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default RecommendationGridSection;
