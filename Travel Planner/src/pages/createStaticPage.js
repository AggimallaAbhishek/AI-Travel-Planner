import React from "react";
import StaticPageLayout from "@/components/layout/StaticPageLayout";
import { STATIC_PAGE_CONTENT } from "@/lib/staticPageContent";

export function createStaticPage(pageKey) {
  function StaticPage() {
    return React.createElement(StaticPageLayout, STATIC_PAGE_CONTENT[pageKey]);
  }

  StaticPage.displayName = `${pageKey}StaticPage`;
  return StaticPage;
}
