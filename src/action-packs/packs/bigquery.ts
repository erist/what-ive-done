import type { ActionPackDefinition } from "../types.js";

export const bigqueryActionPack: ActionPackDefinition = {
  id: "bigquery",
  version: 1,
  priority: 85,
  rules: [
    {
      id: "open-query-workspace",
      layer: "domain_pack",
      domainPackIds: ["bigquery-console"],
      routeFamilies: ["bigquery-console.sql-workspace"],
      eventTypes: ["page_navigation", "application_switch"],
      actionName: "open_query_workspace",
      confidence: 0.96,
    },
    {
      id: "run-query",
      layer: "domain_pack",
      domainPackIds: ["bigquery-console"],
      routeFamilies: ["bigquery-console.sql-workspace"],
      targetIncludes: ["run_query", "execute_query"],
      actionName: "run_query",
      confidence: 0.98,
    },
    {
      id: "save-query",
      layer: "domain_pack",
      domainPackIds: ["bigquery-console"],
      routeFamilies: ["bigquery-console.sql-workspace", "bigquery-console.saved-queries"],
      targetIncludes: ["save_query", "bookmark_query"],
      actionName: "save_query",
      confidence: 0.95,
    },
    {
      id: "open-saved-queries",
      layer: "domain_pack",
      domainPackIds: ["bigquery-console"],
      routeFamilies: ["bigquery-console.saved-queries"],
      eventTypes: ["page_navigation", "application_switch"],
      actionName: "open_saved_queries",
      confidence: 0.92,
    },
    {
      id: "export-query-results",
      layer: "domain_pack",
      domainPackIds: ["bigquery-console"],
      targetIncludes: ["export_results", "download_results"],
      actionName: "export_query_results",
      confidence: 0.93,
    },
  ],
};
