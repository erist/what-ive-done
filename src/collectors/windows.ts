import { fileURLToPath } from "node:url";

import type { CollectorInfo } from "./types.js";

export function getWindowsActiveWindowCollectorInfo(): CollectorInfo {
  return {
    id: "windows-active-window",
    name: "Windows Active Window Collector",
    platform: "windows",
    runtime: "powershell",
    description:
      "Captures active application and window title changes, then writes NDJSON or POSTs to the local ingest server.",
    supportedEventTypes: ["app.switch"],
    scriptPath: fileURLToPath(new URL("../../collectors/windows/active-window-collector.ps1", import.meta.url)),
    sampleFixturePath: fileURLToPath(
      new URL("../../fixtures/windows-active-window-sample.ndjson", import.meta.url),
    ),
  };
}
