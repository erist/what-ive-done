import type { NormalizedEvent, RawEvent } from "../domain/types.js";
import { stableId } from "../domain/ids.js";

const ACTION_BY_SOURCE_EVENT_TYPE: Record<string, string> = {
  "app.switch": "application_switch",
  "application.switch": "application_switch",
  "browser.click": "button_click",
  "chrome.click": "button_click",
  "chrome.navigation": "page_navigation",
  "clipboard.use": "clipboard_usage",
  "dom.click": "button_click",
  "file.delete": "file_operation",
  "file.download": "file_download",
  "file.open": "file_operation",
  "file.save": "file_operation",
  "form.submit": "form_submit",
  "mouse.click": "button_click",
  "tab.navigation": "page_navigation",
};

function normalizeAction(rawEvent: RawEvent): string {
  return ACTION_BY_SOURCE_EVENT_TYPE[rawEvent.sourceEventType] ?? rawEvent.action;
}

export function normalizeRawEvents(rawEvents: RawEvent[]): NormalizedEvent[] {
  return [...rawEvents]
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
    .map((rawEvent) => ({
      id: stableId("normalized_event", rawEvent.id),
      rawEventId: rawEvent.id,
      timestamp: rawEvent.timestamp,
      application: rawEvent.application,
      domain: rawEvent.domain,
      action: normalizeAction(rawEvent),
      target: rawEvent.target,
      metadata: {
        ...rawEvent.metadata,
        sourceEventType: rawEvent.sourceEventType,
        source: rawEvent.source,
        url: rawEvent.url,
        windowTitle: rawEvent.windowTitle,
      },
      createdAt: new Date().toISOString(),
    }));
}
