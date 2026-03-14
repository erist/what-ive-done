import { fileURLToPath } from "node:url";

export interface CollectorInfo {
  id: string;
  name: string;
  platform: string;
  description: string;
  supportedEventTypes: string[];
  scriptPath?: string | undefined;
  sampleFixturePath?: string | undefined;
}

export function getAvailableCollectors(): CollectorInfo[] {
  return [getWindowsActiveWindowCollectorInfo()];
}

export function getWindowsActiveWindowCollectorInfo(): CollectorInfo {
  return {
    id: "windows-active-window",
    name: "Windows Active Window Collector",
    platform: "windows",
    description:
      "Captures active application and window title changes, then writes NDJSON or POSTs to the local ingest server.",
    supportedEventTypes: ["app.switch"],
    scriptPath: fileURLToPath(new URL("../../collectors/windows/active-window-collector.ps1", import.meta.url)),
    sampleFixturePath: fileURLToPath(
      new URL("../../fixtures/windows-active-window-sample.ndjson", import.meta.url),
    ),
  };
}
