import type { DomainPackContext, DomainPackDefinition } from "../types.js";

const NOTION_AUTH_ROUTE = /^\/(?:api|login|signin|logout|signup)(?:\/|$)/i;

export const notionPack: DomainPackDefinition = {
  id: "notion",
  version: 1,
  domainTokens: ["notion.so", "notion.site"],
  match(context) {
    const routeTemplate = context.routeTaxonomy?.routeTemplate ?? context.routeTemplate;

    if (!routeTemplate || NOTION_AUTH_ROUTE.test(routeTemplate)) {
      return undefined;
    }

    if (routeTemplate === "/") {
      return {
        routeFamily: "notion.workspace.home",
        pageType: "notion_workspace",
        resourceHint: "page",
        matchSource: context.routeTaxonomy?.routeTemplate ? "route_taxonomy" : "route_template",
      };
    }

    return {
      routeFamily: "notion.page.view",
      pageType: "notion_page",
      resourceHint: "page",
      matchSource: context.routeTaxonomy?.routeTemplate ? "route_taxonomy" : "route_template",
    };
  },
};
