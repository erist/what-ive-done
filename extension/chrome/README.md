# Chrome Extension

This folder contains a Manifest V3 Chrome extension that sends browser activity metadata
to the local `what-ive-done` ingest server.

Recommended local target:

- the ingest endpoint managed by `npm run dev -- agent:run`

Fallback target:

- the standalone ingest endpoint started with `npm run dev -- serve`

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

Configure the local ingest endpoint from the extension options page after loading the
folder as an unpacked extension in Chrome.
