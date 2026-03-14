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
