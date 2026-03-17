export interface PageTypeRule {
  id: string;
  domainIncludes?: string[] | undefined;
  pathPattern?: RegExp | undefined;
  titlePattern?: RegExp | undefined;
  pageType: string;
  resourceHint?: string | undefined;
}

export interface BrowserCanonicalizationConfig {
  schemaVersion: number;
  canonicalPathDepth: number;
  allowlistedQueryParameters: string[];
}

export interface NormalizationConfig {
  browser: BrowserCanonicalizationConfig;
  appAliases: Record<string, string>;
  pageTypeRules: PageTypeRule[];
}

export interface ActionAbstractionConfig {
  nearbyContextWindowMs: number;
}

export interface SessionSegmentationConfig {
  inactivityThresholdMs: number;
  contextShiftThresholdMs: number;
  interruptionResetThresholdMs: number;
  significantContextScore: number;
  rollingWindowMs: number;
  rollingMinimumGapMs: number;
}

export const DEFAULT_NORMALIZATION_CONFIG: NormalizationConfig = {
  browser: {
    schemaVersion: 2,
    canonicalPathDepth: 2,
    allowlistedQueryParameters: [
      "filter",
      "mode",
      "page",
      "section",
      "sort",
      "status",
      "tab",
      "type",
      "view",
    ],
  },
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
};

export const DEFAULT_SESSION_SEGMENTATION_CONFIG: SessionSegmentationConfig = {
  inactivityThresholdMs: 150 * 1000,
  contextShiftThresholdMs: 75 * 1000,
  interruptionResetThresholdMs: 60 * 1000,
  significantContextScore: 2,
  rollingWindowMs: 5 * 60 * 1000,
  rollingMinimumGapMs: 45 * 1000,
};
