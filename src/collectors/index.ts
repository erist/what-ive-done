import type { CollectorInfo } from "./types.js";
import { getGWSCalendarCollectorInfo } from "./gws-calendar.js";
import { getGWSDriveCollectorInfo } from "./gws-drive.js";
import { getGWSSheetsCollectorInfo } from "./gws-sheets.js";
import { getGitContextCollectorInfo } from "./git-context.js";
import { getMacOSActiveWindowCollectorInfo } from "./macos.js";
import { getWindowsActiveWindowCollectorInfo } from "./windows.js";

export type { CollectorInfo } from "./types.js";

export function getAvailableCollectors(): CollectorInfo[] {
  return [
    getWindowsActiveWindowCollectorInfo(),
    getMacOSActiveWindowCollectorInfo(),
    getGWSCalendarCollectorInfo(),
    getGWSDriveCollectorInfo(),
    getGWSSheetsCollectorInfo(),
    getGitContextCollectorInfo(),
  ];
}
