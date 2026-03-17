import type { DomainPackContext, DomainPackDefinition } from "../types.js";

export const bigqueryConsolePack: DomainPackDefinition = {
  id: "bigquery-console",
  version: 1,
  domainTokens: ["console.cloud.google.com"],
  match(context) {
    const signature = context.routeTaxonomy?.signature;
    const routeTemplate = context.routeTaxonomy?.routeTemplate ?? context.routeTemplate;

    if (signature === "hash:/sqlworkspace" || routeTemplate === "/sqlworkspace") {
      return {
        routeFamily: "bigquery-console.sql-workspace",
        pageType: "bigquery_sql_workspace",
        resourceHint: "query",
        matchSource: "route_taxonomy",
      };
    }

    if (signature === "hash:/savedqueries" || routeTemplate === "/savedqueries") {
      return {
        routeFamily: "bigquery-console.saved-queries",
        pageType: "bigquery_saved_queries",
        resourceHint: "query",
        matchSource: "route_taxonomy",
      };
    }

    if (signature === "hash:/bigquery" || routeTemplate === "/bigquery") {
      return {
        routeFamily: "bigquery-console.workspace",
        pageType: "bigquery_workspace",
        resourceHint: "dataset",
        matchSource: "route_taxonomy",
      };
    }

    return undefined;
  },
};
