const {
  deriveRouteTaxonomy,
  deriveDocumentTypeHash,
  buildBrowserContext,
} = globalThis.WhatIveDoneChromeContext;

let cachedRouteSignature;
let cachedDocumentTypeHashPromise;

function buildTargetIdentifier(element) {
  if (!(element instanceof HTMLElement)) {
    return undefined;
  }

  const candidates = [
    element.dataset.testid,
    element.getAttribute("aria-label"),
    element.id,
    element.getAttribute("name"),
    element.getAttribute("role"),
    element.getAttribute("title"),
    element.tagName.toLowerCase(),
  ];

  return candidates.find((value) => typeof value === "string" && value.trim().length > 0);
}

function baseEventPayload() {
  return {
    timestamp: new Date().toISOString(),
    browserSchemaVersion: 2,
    windowTitle: document.title,
    url: window.location.href,
  };
}

function currentRouteSignature() {
  return deriveRouteTaxonomy(window.location.href)?.signature;
}

function resetDocumentTypeHashCache() {
  cachedRouteSignature = undefined;
  cachedDocumentTypeHashPromise = undefined;
}

async function getDocumentTypeHash() {
  const nextRouteSignature = currentRouteSignature() ?? "pathname:/";

  if (cachedRouteSignature === nextRouteSignature && cachedDocumentTypeHashPromise) {
    return cachedDocumentTypeHashPromise;
  }

  cachedRouteSignature = nextRouteSignature;
  cachedDocumentTypeHashPromise = deriveDocumentTypeHash(document);

  return cachedDocumentTypeHashPromise;
}

async function buildCurrentBrowserContext(extra = {}) {
  const routeTaxonomy = deriveRouteTaxonomy(window.location.href);
  const documentTypeHash = await getDocumentTypeHash();

  return buildBrowserContext({
    routeTaxonomy,
    documentTypeHash,
    ...extra,
  });
}

async function sendPageContext() {
  const browserContext = await buildCurrentBrowserContext();

  chrome.runtime.sendMessage({
    type: "page-context",
    context: {
      windowTitle: document.title,
      url: window.location.href,
      browserContext,
    },
  });
}

async function sendDomEvent(eventPayload) {
  const browserContext = await buildCurrentBrowserContext(eventPayload.browserContext);

  chrome.runtime.sendMessage({
    type: "dom-event",
    event: {
      ...eventPayload,
      metadata: {
        ...(eventPayload.metadata || {}),
        browserContext,
      },
    },
  });
}

function scheduleRouteChange(reason) {
  window.setTimeout(() => {
    const nextRouteSignature = currentRouteSignature();

    if (!nextRouteSignature || nextRouteSignature === cachedRouteSignature) {
      void sendPageContext();
      return;
    }

    resetDocumentTypeHashCache();

    void sendDomEvent({
      ...baseEventPayload(),
      sourceEventType: "chrome.route_change",
      action: "navigation",
      target: "route_change",
      metadata: {
        trigger: reason,
      },
    }).then(() => sendPageContext());
  }, 48);
}

function patchHistoryMethod(methodName) {
  const original = history[methodName];

  history[methodName] = function patchedHistoryMethod(...args) {
    const result = original.apply(this, args);

    scheduleRouteChange(`history.${methodName}`);

    return result;
  };
}

patchHistoryMethod("pushState");
patchHistoryMethod("replaceState");

window.addEventListener("popstate", () => {
  scheduleRouteChange("history.popstate");
});

window.addEventListener("hashchange", () => {
  scheduleRouteChange("history.hashchange");
});

document.addEventListener(
  "click",
  (event) => {
    const target = event.target instanceof Element ? event.target.closest("button, a, input, [role='button']") : null;

    void sendDomEvent({
      ...baseEventPayload(),
      sourceEventType: "browser.click",
      action: "click",
      target: buildTargetIdentifier(target ?? event.target),
      metadata: {
        tagName: target instanceof HTMLElement ? target.tagName.toLowerCase() : undefined,
      },
    });
  },
  true,
);

document.addEventListener(
  "submit",
  (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;

    void sendDomEvent({
      ...baseEventPayload(),
      sourceEventType: "form.submit",
      action: "submit",
      target: buildTargetIdentifier(form),
      metadata: {
        method: form?.method || undefined,
        hasFileInput: Boolean(form?.querySelector("input[type='file']")),
      },
    });
  },
  true,
);

window.addEventListener("pageshow", () => {
  void sendPageContext();
});

window.addEventListener("load", () => {
  void sendPageContext();
});

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      void sendPageContext();
    },
    { once: true },
  );
} else {
  void sendPageContext();
}
