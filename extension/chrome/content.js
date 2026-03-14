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
    element.tagName.toLowerCase()
  ];

  return candidates.find((value) => typeof value === "string" && value.trim().length > 0);
}

function baseEventPayload() {
  return {
    timestamp: new Date().toISOString(),
    windowTitle: document.title,
    url: window.location.href
  };
}

function sendDomEvent(eventPayload) {
  chrome.runtime.sendMessage({
    type: "dom-event",
    event: eventPayload
  });
}

document.addEventListener(
  "click",
  (event) => {
    const target = event.target instanceof Element ? event.target.closest("button, a, input, [role='button']") : null;

    sendDomEvent({
      ...baseEventPayload(),
      sourceEventType: "browser.click",
      action: "click",
      target: buildTargetIdentifier(target ?? event.target),
      metadata: {
        tagName: target instanceof HTMLElement ? target.tagName.toLowerCase() : undefined
      }
    });
  },
  true
);

document.addEventListener(
  "submit",
  (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;

    sendDomEvent({
      ...baseEventPayload(),
      sourceEventType: "form.submit",
      action: "submit",
      target: buildTargetIdentifier(form),
      metadata: {
        method: form?.method || undefined,
        hasFileInput: Boolean(form?.querySelector("input[type='file']"))
      }
    });
  },
  true
);
