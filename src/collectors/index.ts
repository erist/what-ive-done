import type { CollectorInfo } from "./types.js";
import { getGWSCalendarCollectorInfo } from "./gws-calendar.js";
import { getMacOSActiveWindowCollectorInfo } from "./macos.js";
import { getWindowsActiveWindowCollectorInfo } from "./windows.js";

export type { CollectorInfo } from "./types.js";

export function getAvailableCollectors(): CollectorInfo[] {
  return [
    getWindowsActiveWindowCollectorInfo(),
    getMacOSActiveWindowCollectorInfo(),
    getGWSCalendarCollectorInfo(),
  ];
}
