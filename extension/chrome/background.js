const DEFAULT_INGEST_ENDPOINT = "http://127.0.0.1:4318/events";

function safeDomain(urlString) {
  if (!urlString) {
    return undefined;
  }

  try {
    return new URL(urlString).hostname;
  } catch {
    return undefined;
  }
}

function sanitizeUrl(urlString) {
  if (!urlString) {
    return undefined;
  }

  try {
    const url = new URL(urlString);
    url.username = "";
    url.password = "";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

async function getIngestEndpoint() {
  const result = await chrome.storage.sync.get(["ingestEndpoint", "ingestAuthToken"]);
  return {
    endpoint: result.ingestEndpoint || DEFAULT_INGEST_ENDPOINT,
    authToken:
      typeof result.ingestAuthToken === "string" && result.ingestAuthToken.trim().length > 0
        ? result.ingestAuthToken.trim()
        : undefined
  };
}

async function postEvents(events) {
  const { endpoint, authToken } = await getIngestEndpoint();

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { "X-What-Ive-Done-Token": authToken } : {})
      },
      body: JSON.stringify({ events })
    });

    if (!response.ok) {
      console.warn("What I've Done ingest failed", response.status, endpoint);
    }
  } catch (error) {
    console.warn("What I've Done ingest unavailable", endpoint, error);
  }
}

function buildChromeContext(tab) {
  return {
    application: "chrome",
    browserSchemaVersion: 2,
    windowTitle: tab?.title,
    url: sanitizeUrl(tab?.url),
    domain: safeDomain(tab?.url)
  };
}

chrome.runtime.onInstalled.addListener(async () => {
  const result = await chrome.storage.sync.get("ingestEndpoint");

  if (!result.ingestEndpoint) {
    await chrome.storage.sync.set({ ingestEndpoint: DEFAULT_INGEST_ENDPOINT });
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) {
    return;
  }

  void postEvents([
    {
      source: "chrome_extension",
      sourceEventType: "chrome.navigation",
      timestamp: new Date().toISOString(),
      action: "navigation",
      target: "tab_navigation",
      ...buildChromeContext(tab),
      metadata: {
        tabId,
        status: changeInfo.status
      }
    }
  ]);
});

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  const tab = await chrome.tabs.get(tabId);

  void postEvents([
    {
      source: "chrome_extension",
      sourceEventType: "chrome.tab_activated",
      timestamp: new Date().toISOString(),
      action: "tab_activated",
      target: "tab_focus",
      ...buildChromeContext(tab),
      metadata: {
        tabId,
        windowId
      }
    }
  ]);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "dom-event" || !message.event) {
    sendResponse({ ok: false });
    return false;
  }

  void postEvents([
    {
      source: "chrome_extension",
      sourceEventType: message.event.sourceEventType,
      timestamp: message.event.timestamp || new Date().toISOString(),
      application: "chrome",
      browserSchemaVersion: message.event.browserSchemaVersion || 2,
      windowTitle: message.event.windowTitle,
      url: sanitizeUrl(message.event.url),
      domain: safeDomain(message.event.url),
      action: message.event.action,
      target: message.event.target,
      metadata: message.event.metadata || {}
    }
  ]).then(() => sendResponse({ ok: true }));

  return true;
});
