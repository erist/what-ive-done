# Chrome Context Privacy Review

Scope: M3 Chrome Context Expansion.

## Stored Signals

- normalized route taxonomy
  - `source`
  - `signature`
  - `routeTemplate`
  - section hints and dynamic-segment count
- opaque `documentTypeHash`
  - derived from coarse document structure only
- tab-order metadata
  - activation counters, tab index, previous tab id, window id
- dwell segment metadata
  - duration, started/ended timestamps, and end reason

## Explicit Non-Collection

- raw DOM text or HTML
- form field values
- hash-fragment source text
- cookies, tokens, or session identifiers
- screenshots or continuous screen capture

## Storage Notes

- top-level browser schema v2 fields remain sanitized through [`src/privacy/browser.ts`](../../src/privacy/browser.ts)
- `metadata.browserContext` is revalidated and reduced to an allowlisted shape in [`src/privacy/sanitize.ts`](../../src/privacy/sanitize.ts)
- `chrome.dwell` events are stored as raw signal-only events with `signalOnly = true`
- signal-only dwell events are filtered out before normalized workflow analysis so they do not become workflow steps

## Regression Gates

- [`src/chrome-context.test.ts`](../../src/chrome-context.test.ts)
- [`src/privacy/sanitize.test.ts`](../../src/privacy/sanitize.test.ts)
- [`src/server/ingest.test.ts`](../../src/server/ingest.test.ts)
