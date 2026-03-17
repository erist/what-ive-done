import type { DomainPackContext, DomainPackDefinition } from "../types.js";

const DOC_ROUTE_PATTERNS = [
  /^\/document\/d\/(?:\{(?:id|uuid)\}|[a-z0-9_-]+)\/edit$/i,
  /^\/document\/u\/\{id\}\/d\/(?:\{(?:id|uuid)\}|[a-z0-9_-]+)\/edit$/i,
];

export const googleDocsPack: DomainPackDefinition = {
  id: "google-docs",
  version: 1,
  domainTokens: ["docs.google.com"],
  match(context) {
    const routeTemplate = context.routeTaxonomy?.routeTemplate ?? context.routeTemplate;

    if (!routeTemplate || !DOC_ROUTE_PATTERNS.some((pattern) => pattern.test(routeTemplate))) {
      return undefined;
    }

    return {
      routeFamily: "google-docs.document.edit",
      pageType: "document_edit",
      resourceHint: "document",
      matchSource: "route_template",
    };
  },
};
