import { fileURLToPath } from "node:url";

import type { CollectorInfo } from "./types.js";

export function getMacOSActiveWindowCollectorInfo(): CollectorInfo {
  return {
    id: "macos-active-window",
    name: "macOS Active Window Collector",
    platform: "macos",
    runtime: "swift",
    description:
      "Captures frontmost application changes and focused window titles when Accessibility permission is available.",
    supportedEventTypes: ["app.switch"],
    scriptPath: fileURLToPath(new URL("../../collectors/macos/active-window-collector.swift", import.meta.url)),
    sampleFixturePath: fileURLToPath(new URL("../../fixtures/macos-active-window-sample.ndjson", import.meta.url)),
  };
}
