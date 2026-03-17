# Chrome Extension

This folder contains a Manifest V3 Chrome extension that sends browser activity metadata
to the local `what-ive-done` ingest server.

Recommended local target:

- the ingest endpoint managed by `npm run dev -- agent:run`

Fallback target:

- the standalone ingest endpoint started with `npm run dev -- serve`

The local ingest server is localhost-only and now requires a shared auth token for
browser POST requests.

Captured event categories:

- tab navigation
- tab activation
- DOM click metadata
- form submission metadata

The extension intentionally avoids collecting:

- field values
- raw text input
- passwords
- clipboard contents

Before using the extension:

1. Generate or print the local ingest auth token:
   `npm run dev -- ingest:token --data-dir ./tmp/live-data --rotate`
2. Start the local server or resident agent:
   `npm run dev -- agent:run --data-dir ./tmp/live-data`
3. Open the extension options page and set both:
   - ingest endpoint
   - ingest auth token

Configure the local ingest endpoint and auth token from the extension options page after
loading the folder as an unpacked extension in Chrome.
