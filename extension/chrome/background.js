import "./context.js";

const DEFAULT_INGEST_ENDPOINT = "http://127.0.0.1:4318/events";

const {
  safeDomain,
  sanitizeUrl,
  deriveRouteTaxonomy,
  buildBrowserContext,
} = globalThis.WhatIveDoneChromeContext;

const tabStateById = new Map();
const windowStateById = new Map();

let globalActivationSequence = 0;
let focusedWindowId;

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getTabState(tabId) {
  const existing = tabStateById.get(tabId);

  if (existing) {
    return existing;
  }

  const created = {
    url: undefined,
    windowTitle: undefined,
    windowId: undefined,
    tabIndex: undefined,
    browserContext: undefined,
    lastTabOrder: undefined,
    activeSince: undefined,
  };

  tabStateById.set(tabId, created);
  return created;
}

function getWindowState(windowId) {
  const existing = windowStateById.get(windowId);

  if (existing) {
    return existing;
  }

  const created = {
    sequence: 0,
    activeTabId: undefined,
  };

  windowStateById.set(windowId, created);
  return created;
}

async function getTabSafely(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return undefined;
  }
}

function mergeBrowserContext(currentValue, incomingValue) {
  const current = isRecord(currentValue) ? currentValue : {};
  const incoming = isRecord(incomingValue) ? incomingValue : {};

  return buildBrowserContext({
    routeTaxonomy: incoming.routeTaxonomy ?? current.routeTaxonomy,
    documentTypeHash: incoming.documentTypeHash ?? current.documentTypeHash,
    tabOrder: incoming.tabOrder ?? current.tabOrder,
    dwell: incoming.dwell ?? current.dwell,
    signalOnly:
      incoming.signalOnly === true || current.signalOnly === true ? true : undefined,
  });
}

function extractIncomingBrowserContext(metadata) {
  if (!isRecord(metadata) || !isRecord(metadata.browserContext)) {
    return undefined;
  }

  return metadata.browserContext;
}

function recordTabSnapshot(tab, state) {
  if (!tab) {
    return;
  }

  state.url = sanitizeUrl(tab.url) ?? state.url;
  state.windowTitle = tab.title ?? state.windowTitle;
  state.windowId = typeof tab.windowId === "number" ? tab.windowId : state.windowId;
  state.tabIndex = typeof tab.index === "number" ? tab.index : state.tabIndex;
}

function resolveBrowserContextForTab(tab, state, overrides = {}) {
  const effectiveUrl = overrides.url ?? state.url ?? tab?.url;
  const normalizedEffectiveUrl = sanitizeUrl(effectiveUrl);
  const normalizedStateUrl = sanitizeUrl(state.url);
  const stateMatchesUrl =
    Boolean(normalizedEffectiveUrl) &&
    normalizedEffectiveUrl === normalizedStateUrl;

  const browserContext = buildBrowserContext({
    routeTaxonomy:
      overrides.routeTaxonomy ??
      (stateMatchesUrl ? state.browserContext?.routeTaxonomy : undefined) ??
      deriveRouteTaxonomy(effectiveUrl),
    documentTypeHash:
      overrides.documentTypeHash ??
      (stateMatchesUrl ? state.browserContext?.documentTypeHash : undefined),
    tabOrder: overrides.tabOrder ?? state.lastTabOrder,
    dwell: overrides.dwell,
    signalOnly: overrides.signalOnly === true ? true : undefined,
  });

  return Object.keys(browserContext).length > 0 ? browserContext : undefined;
}

function createCollectorEvent(args) {
  const state =
    typeof args.tab?.id === "number"
      ? getTabState(args.tab.id)
      : {
          url: args.url,
          windowTitle: args.windowTitle,
          windowId: args.windowId,
          browserContext: undefined,
          lastTabOrder: undefined,
        };
  const browserContext = resolveBrowserContextForTab(args.tab, state, {
    ...args.browserContext,
    url: args.url,
  });

  return compactObject({
    source: "chrome_extension",
    sourceEventType: args.sourceEventType,
    timestamp: args.timestamp,
    action: args.action,
    target: args.target,
    application: "chrome",
    browserSchemaVersion: 2,
    windowTitle: args.windowTitle ?? state.windowTitle ?? args.tab?.title,
    url: sanitizeUrl(args.url ?? state.url ?? args.tab?.url),
    domain: safeDomain(args.url ?? state.url ?? args.tab?.url),
    metadata: compactObject({
      ...(isRecord(args.metadata) ? args.metadata : {}),
      browserContext,
    }),
  });
}

function storePageContext(tabId, context, tab) {
  const state = getTabState(tabId);

  recordTabSnapshot(tab, state);

  if (typeof context.url === "string") {
    state.url = sanitizeUrl(context.url) ?? state.url;
  }

  if (typeof context.windowTitle === "string" && context.windowTitle.trim().length > 0) {
    state.windowTitle = context.windowTitle;
  }

  if (isRecord(context.browserContext)) {
    state.browserContext = mergeBrowserContext(state.browserContext, context.browserContext);
  }
}

function nextTabOrder(tab, previousTabId) {
  globalActivationSequence += 1;

  const windowState = getWindowState(tab.windowId);
  windowState.sequence += 1;

  return compactObject({
    globalSequence: globalActivationSequence,
    windowSequence: windowState.sequence,
    tabIndex: typeof tab.index === "number" ? tab.index : undefined,
    previousTabId,
    windowId: tab.windowId,
  });
}

async function postEvents(events) {
  const result = await chrome.storage.sync.get(["ingestEndpoint", "ingestAuthToken"]);
  const endpoint = result.ingestEndpoint || DEFAULT_INGEST_ENDPOINT;
  const authToken =
    typeof result.ingestAuthToken === "string" && result.ingestAuthToken.trim().length > 0
      ? result.ingestAuthToken.trim()
      : undefined;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { "X-What-Ive-Done-Token": authToken } : {}),
      },
      body: JSON.stringify({ events }),
    });

    if (!response.ok) {
      console.warn("What I've Done ingest failed", response.status, endpoint);
    }
  } catch (error) {
    console.warn("What I've Done ingest unavailable", endpoint, error);
  }
}

async function flushDwellSegment(tabId, reason, endedAt = new Date().toISOString()) {
  const state = tabStateById.get(tabId);

  if (!state?.activeSince) {
    return;
  }

  const startedAtMs = Date.parse(state.activeSince);
  const endedAtMs = Date.parse(endedAt);

  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs) || endedAtMs <= startedAtMs) {
    state.activeSince = undefined;
    return;
  }

  const tab = await getTabSafely(tabId);

  if (tab) {
    recordTabSnapshot(tab, state);
  }

  const event = createCollectorEvent({
    sourceEventType: "chrome.dwell",
    timestamp: endedAt,
    action: "dwell",
    target: "route_dwell",
    tab,
    url: state.url,
    windowTitle: state.windowTitle,
    browserContext: {
      dwell: {
        durationMs: endedAtMs - startedAtMs,
        startedAt: state.activeSince,
        endedAt,
        reason,
      },
      signalOnly: true,
    },
    metadata: compactObject({
      tabId,
      windowId: state.windowId,
    }),
  });

  state.activeSince = undefined;

  await postEvents([event]);
}

chrome.runtime.onInstalled.addListener(async () => {
  const result = await chrome.storage.sync.get("ingestEndpoint");

  if (!result.ingestEndpoint) {
    await chrome.storage.sync.set({ ingestEndpoint: DEFAULT_INGEST_ENDPOINT });
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const state = getTabState(tabId);
  const previousUrl = state.url;

  recordTabSnapshot(tab, state);

  if (tab.active && changeInfo.url && previousUrl && sanitizeUrl(changeInfo.url) !== previousUrl) {
    await flushDwellSegment(tabId, "navigation");
  }

  if (changeInfo.status !== "complete" || !tab.url) {
    return;
  }

  const event = createCollectorEvent({
    sourceEventType: "chrome.navigation",
    timestamp: new Date().toISOString(),
    action: "navigation",
    target: "tab_navigation",
    tab,
    metadata: {
      tabId,
      status: changeInfo.status,
    },
  });

  if (tab.active) {
    state.activeSince = event.timestamp;
  }

  await postEvents([event]);
});

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  const windowState = getWindowState(windowId);
  const previousTabId = windowState.activeTabId;

  if (typeof previousTabId === "number" && previousTabId !== tabId) {
    await flushDwellSegment(previousTabId, "tab_switch");
  }

  const tab = await getTabSafely(tabId);
  const state = getTabState(tabId);

  if (tab) {
    recordTabSnapshot(tab, state);
  }

  const tabOrder = tab
    ? nextTabOrder(tab, previousTabId)
    : compactObject({
        globalSequence: ++globalActivationSequence,
        previousTabId,
        windowId,
      });

  state.lastTabOrder = tabOrder;
  state.activeSince = new Date().toISOString();
  windowState.activeTabId = tabId;

  const event = createCollectorEvent({
    sourceEventType: "chrome.tab_activated",
    timestamp: state.activeSince,
    action: "tab_activated",
    target: "tab_focus",
    tab,
    url: tab?.url ?? state.url,
    windowTitle: tab?.title ?? state.windowTitle,
    browserContext: {
      tabOrder,
    },
    metadata: {
      tabId,
      windowId,
    },
  });

  await postEvents([event]);
});

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  await flushDwellSegment(tabId, "tab_closed");

  tabStateById.delete(tabId);

  const windowState = windowStateById.get(removeInfo.windowId);

  if (windowState?.activeTabId === tabId) {
    windowState.activeTabId = undefined;
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  const previousFocusedWindowId = focusedWindowId;

  if (
    typeof previousFocusedWindowId === "number" &&
    previousFocusedWindowId !== chrome.windows.WINDOW_ID_NONE &&
    previousFocusedWindowId !== windowId
  ) {
    const previousActiveTabId = windowStateById.get(previousFocusedWindowId)?.activeTabId;

    if (typeof previousActiveTabId === "number") {
      await flushDwellSegment(previousActiveTabId, "window_blur");
    }
  }

  focusedWindowId = windowId === chrome.windows.WINDOW_ID_NONE ? undefined : windowId;

  if (typeof focusedWindowId === "number") {
    const activeTabId = windowStateById.get(focusedWindowId)?.activeTabId;

    if (typeof activeTabId === "number") {
      getTabState(activeTabId).activeSince = new Date().toISOString();
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tab = sender.tab;
  const tabId = tab?.id;

  if (message?.type === "page-context" && typeof tabId === "number" && isRecord(message.context)) {
    storePageContext(tabId, message.context, tab);

    if (tab?.active && !getTabState(tabId).activeSince) {
      getTabState(tabId).activeSince = new Date().toISOString();
    }

    sendResponse({ ok: true });
    return false;
  }

  if (message?.type !== "dom-event" || !isRecord(message.event) || typeof tabId !== "number") {
    sendResponse({ ok: false });
    return false;
  }

  void (async () => {
    const state = getTabState(tabId);
    const timestamp =
      typeof message.event.timestamp === "string" ? message.event.timestamp : new Date().toISOString();
    const incomingMetadata = isRecord(message.event.metadata) ? message.event.metadata : {};
    const incomingBrowserContext = extractIncomingBrowserContext(incomingMetadata);
    const previousSignature = state.browserContext?.routeTaxonomy?.signature;
    const nextSignature = incomingBrowserContext?.routeTaxonomy?.signature;

    recordTabSnapshot(tab, state);

    if (
      tab?.active &&
      message.event.sourceEventType === "chrome.route_change" &&
      previousSignature &&
      nextSignature &&
      previousSignature !== nextSignature
    ) {
      await flushDwellSegment(tabId, "route_change", timestamp);
    }

    if (typeof message.event.url === "string") {
      state.url = sanitizeUrl(message.event.url) ?? state.url;
    }

    if (typeof message.event.windowTitle === "string" && message.event.windowTitle.trim().length > 0) {
      state.windowTitle = message.event.windowTitle;
    }

    if (incomingBrowserContext) {
      state.browserContext = mergeBrowserContext(state.browserContext, incomingBrowserContext);
    }

    const event = createCollectorEvent({
      sourceEventType:
        typeof message.event.sourceEventType === "string"
          ? message.event.sourceEventType
          : "browser.unknown",
      timestamp,
      action: typeof message.event.action === "string" ? message.event.action : undefined,
      target: typeof message.event.target === "string" ? message.event.target : undefined,
      tab,
      url: typeof message.event.url === "string" ? message.event.url : undefined,
      windowTitle:
        typeof message.event.windowTitle === "string" ? message.event.windowTitle : undefined,
      browserContext: incomingBrowserContext,
      metadata: incomingMetadata,
    });

    if (tab?.active && (!state.activeSince || message.event.sourceEventType === "chrome.route_change")) {
      state.activeSince = timestamp;
    }

    await postEvents([event]);
    sendResponse({ ok: true });
  })().catch(() => {
    sendResponse({ ok: false });
  });

  return true;
});
