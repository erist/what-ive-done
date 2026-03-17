import type { DomainPackContext, DomainPackDefinition } from "../types.js";

const SHEET_ROUTE_PATTERNS = [
  /^\/spreadsheets\/d\/(?:\{(?:id|uuid)\}|[a-z0-9_-]+)\/edit$/i,
  /^\/spreadsheets\/u\/\{id\}\/d\/(?:\{(?:id|uuid)\}|[a-z0-9_-]+)\/edit$/i,
];

export const googleSheetsPack: DomainPackDefinition = {
  id: "google-sheets",
  version: 1,
  domainTokens: ["docs.google.com"],
  match(context) {
    const routeTemplate = context.routeTaxonomy?.routeTemplate ?? context.routeTemplate;

    if (!routeTemplate || !SHEET_ROUTE_PATTERNS.some((pattern) => pattern.test(routeTemplate))) {
      return undefined;
    }

    return {
      routeFamily: "google-sheets.sheet.edit",
      pageType: "sheet_edit",
      resourceHint: "sheet",
      matchSource: "route_template",
    };
  },
};
