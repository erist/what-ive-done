import type { ActionPackDefinition } from "../types.js";

export const generalWebActionPack: ActionPackDefinition = {
  id: "general-web",
  version: 1,
  priority: 40,
  rules: [
    {
      id: "open-admin",
      layer: "generic",
      applications: ["chrome", "safari", "firefox"],
      domains: ["admin"],
      eventTypes: ["page_navigation", "application_switch"],
      actionName: "open_admin",
      confidence: 0.9,
    },
    {
      id: "search-order",
      layer: "generic",
      applications: ["chrome", "safari", "firefox"],
      targetIncludes: ["search_order", "order_search"],
      actionName: "search_order",
      confidence: 0.97,
    },
    {
      id: "update-status",
      layer: "generic",
      applications: ["chrome", "safari", "firefox"],
      targetIncludes: ["status", "approve_refund", "reschedule_delivery"],
      actionName: "update_status",
      confidence: 0.92,
    },
    {
      id: "notify-customer",
      layer: "generic",
      applications: ["chrome", "safari", "firefox"],
      targetIncludes: ["notify_customer", "send_confirmation"],
      actionName: "notify_customer",
      confidence: 0.9,
    },
    {
      id: "export-excel-download",
      layer: "generic",
      applications: ["chrome", "safari", "firefox"],
      eventTypes: ["file_download"],
      actionName: "export_excel",
      confidence: 0.95,
    },
    {
      id: "export-excel-target",
      layer: "generic",
      applications: ["chrome", "safari", "firefox"],
      targetIncludes: ["export", "download"],
      actionName: "export_excel",
      confidence: 0.89,
    },
  ],
};
