import type { CollectorInfo } from "./types.js";
import { getMacOSActiveWindowCollectorInfo } from "./macos.js";
import { getWindowsActiveWindowCollectorInfo } from "./windows.js";

export type { CollectorInfo } from "./types.js";

export function getAvailableCollectors(): CollectorInfo[] {
  return [getWindowsActiveWindowCollectorInfo(), getMacOSActiveWindowCollectorInfo()];
}
