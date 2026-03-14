import type { ActionSource } from "../domain/types.js";

export interface PageTypeRule {
  id: string;
  domainIncludes?: string[] | undefined;
  pathPattern?: RegExp | undefined;
  titlePattern?: RegExp | undefined;
  pageType: string;
  resourceHint?: string | undefined;
}

export interface NormalizationConfig {
  stripQueryParameters: boolean;
  appAliases: Record<string, string>;
  pageTypeRules: PageTypeRule[];
}

export interface ActionRule {
  id: string;
  applications?: string[] | undefined;
  domains?: string[] | undefined;
  eventTypes?: string[] | undefined;
  pageTypes?: string[] | undefined;
  targetIncludes?: string[] | undefined;
  resourceHints?: string[] | undefined;
  actionName: string;
  confidence: number;
  source?: ActionSource | undefined;
}

export interface ActionAbstractionConfig {
  nearbyContextWindowMs: number;
  rules: ActionRule[];
}

export const DEFAULT_NORMALIZATION_CONFIG: NormalizationConfig = {
  stripQueryParameters: true,
  appAliases: {
    chrome: "chrome",
    "google chrome": "chrome",
    "chrome browser": "chrome",
    safari: "safari",
    firefox: "firefox",
    slack: "slack",
    "slack desktop": "slack",
    excel: "excel",
    "microsoft excel": "excel",
    outlook: "outlook",
    "microsoft outlook": "outlook",
    notion: "notion",
    "visual studio code": "vscode",
    vscode: "vscode",
    terminal: "terminal",
    iterm2: "terminal",
  },
  pageTypeRules: [
    {
      id: "admin-product-edit",
      domainIncludes: ["admin"],
      pathPattern: /^\/products?\/\{id\}\/edit$/,
      pageType: "product_edit",
      resourceHint: "product",
    },
    {
      id: "admin-order-detail",
      domainIncludes: ["admin"],
      pathPattern: /^\/orders?\/\{id\}(?:\/view)?$/,
      pageType: "order_detail",
      resourceHint: "order",
    },
    {
      id: "admin-order-title",
      titlePattern: /\border\b.*#\{id\}/i,
      pageType: "order_detail",
      resourceHint: "order",
    },
    {
      id: "admin-refund",
      domainIncludes: ["admin"],
      pathPattern: /^\/refunds?(?:\/\{id\})?(?:\/edit)?$/,
      pageType: "refund_review",
      resourceHint: "refund",
    },
    {
      id: "ticket-detail",
      pathPattern: /^\/tickets?\/\{id\}$/,
      pageType: "ticket_detail",
      resourceHint: "ticket",
    },
  ],
};

export const DEFAULT_ACTION_ABSTRACTION_CONFIG: ActionAbstractionConfig = {
  nearbyContextWindowMs: 45 * 1000,
  rules: [
    {
      id: "admin-product-edit",
      domains: ["admin"],
      pageTypes: ["product_edit"],
      eventTypes: ["button_click", "form_submit", "page_navigation"],
      resourceHints: ["product"],
      actionName: "edit_product",
      confidence: 0.96,
    },
    {
      id: "admin-open",
      domains: ["admin"],
      eventTypes: ["page_navigation", "application_switch"],
      actionName: "open_admin",
      confidence: 0.88,
    },
    {
      id: "search-order",
      targetIncludes: ["search_order", "order_search"],
      actionName: "search_order",
      confidence: 0.97,
    },
    {
      id: "update-status",
      targetIncludes: ["status", "approve_refund", "reschedule_delivery"],
      actionName: "update_status",
      confidence: 0.93,
    },
    {
      id: "export-excel",
      eventTypes: ["file_download"],
      actionName: "export_excel",
      confidence: 0.95,
    },
    {
      id: "export-excel-target",
      targetIncludes: ["export", "download"],
      actionName: "export_excel",
      confidence: 0.9,
    },
    {
      id: "send-slack-report",
      applications: ["slack"],
      targetIncludes: ["send", "notify", "reply", "report"],
      actionName: "send_slack_report",
      confidence: 0.92,
    },
    {
      id: "send-email-response",
      applications: ["outlook"],
      targetIncludes: ["send", "confirmation", "email"],
      actionName: "send_email_response",
      confidence: 0.9,
    },
    {
      id: "open-sheet",
      applications: ["excel"],
      targetIncludes: ["sheet", "open"],
      actionName: "open_sheet",
      confidence: 0.89,
    },
    {
      id: "save-sheet",
      applications: ["excel"],
      targetIncludes: ["save", "sheet"],
      actionName: "save_sheet",
      confidence: 0.9,
    },
  ],
};
