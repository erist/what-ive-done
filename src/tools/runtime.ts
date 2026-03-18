import {
  DEFAULT_GWS_CALENDAR_ID,
  getGWSCalendarCollectorStatus,
  type GWSCalendarCollectorStatus,
} from "../collectors/gws-calendar.js";
import {
  getGWSDriveCollectorStatus,
  type GWSDriveCollectorStatus,
} from "../collectors/gws-drive.js";
import {
  getGWSSheetsCollectorStatus,
  type GWSSheetsCollectorStatus,
} from "../collectors/gws-sheets.js";
import {
  getGitContextCollectorStatus,
  type GitContextCollectorStatus,
} from "../collectors/git-context.js";
import type { WidConfig } from "../config/schema.js";

function normalizeOptionalConfigString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isToolAdded(config: WidConfig, toolName: string): boolean {
  return config.tools[toolName]?.added === true;
}

export interface ResolveCollectorRuntimeOptionsInput {
  config: WidConfig;
  gwsCalendar?: boolean | undefined;
  gwsDrive?: boolean | undefined;
  gwsSheets?: boolean | undefined;
  gwsCalendarId?: string | undefined;
  gitRepo?: string | undefined;
  gwsCalendarStatus?: GWSCalendarCollectorStatus | undefined;
  gwsDriveStatus?: GWSDriveCollectorStatus | undefined;
  gwsSheetsStatus?: GWSSheetsCollectorStatus | undefined;
  gitStatus?: GitContextCollectorStatus | undefined;
}

export interface ResolvedCollectorRuntimeOptions {
  enableGWSCalendar: boolean;
  enableGWSDrive: boolean;
  enableGWSSheets: boolean;
  gwsCalendarId: string;
  gitRepoPath?: string | undefined;
  warnings: string[];
}

export function resolveCollectorRuntimeOptions(
  input: ResolveCollectorRuntimeOptionsInput,
): ResolvedCollectorRuntimeOptions {
  const warnings: string[] = [];
  const gwsConfigured = isToolAdded(input.config, "gws");
  const gitConfigured = isToolAdded(input.config, "git");
  const gwsCalendarRequested = input.gwsCalendar ?? gwsConfigured;
  const gwsDriveRequested = input.gwsDrive ?? gwsConfigured;
  const gwsSheetsRequested = input.gwsSheets ?? gwsConfigured;
  const gwsCalendarId =
    input.gwsCalendarId ??
    normalizeOptionalConfigString(input.config.tools.gws?.["calendar-id"]) ??
    DEFAULT_GWS_CALENDAR_ID;
  const requestedGitRepo =
    input.gitRepo ??
    (gitConfigured ? normalizeOptionalConfigString(input.config.tools.git?.["repo-path"]) : undefined);

  const gwsCalendarStatus = gwsCalendarRequested
    ? input.gwsCalendarStatus ?? getGWSCalendarCollectorStatus({
        calendarId: gwsCalendarId,
      })
    : undefined;
  const gwsDriveStatus = gwsDriveRequested ? input.gwsDriveStatus ?? getGWSDriveCollectorStatus() : undefined;
  const gwsSheetsStatus = gwsSheetsRequested ? input.gwsSheetsStatus ?? getGWSSheetsCollectorStatus() : undefined;
  const gitStatus = requestedGitRepo
    ? input.gitStatus ?? getGitContextCollectorStatus({
        repoPath: requestedGitRepo,
      })
    : undefined;

  if (gwsCalendarRequested && !gwsCalendarStatus?.ready) {
    warnings.push(`gws-calendar skipped: ${gwsCalendarStatus?.detail ?? gwsCalendarStatus?.status ?? "not ready"}`);
  }

  if (gwsDriveRequested && !gwsDriveStatus?.ready) {
    warnings.push(`gws-drive skipped: ${gwsDriveStatus?.detail ?? gwsDriveStatus?.status ?? "not ready"}`);
  }

  if (gwsSheetsRequested && !gwsSheetsStatus?.ready) {
    warnings.push(`gws-sheets skipped: ${gwsSheetsStatus?.detail ?? gwsSheetsStatus?.status ?? "not ready"}`);
  }

  if (requestedGitRepo && !gitStatus?.ready) {
    warnings.push(`git skipped: ${gitStatus?.detail ?? gitStatus?.status ?? "not ready"}`);
  }

  return {
    enableGWSCalendar: Boolean(gwsCalendarRequested && gwsCalendarStatus?.ready),
    enableGWSDrive: Boolean(gwsDriveRequested && gwsDriveStatus?.ready),
    enableGWSSheets: Boolean(gwsSheetsRequested && gwsSheetsStatus?.ready),
    gwsCalendarId,
    gitRepoPath: gitStatus?.ready ? gitStatus.selectedRepoPath ?? requestedGitRepo : undefined,
    warnings,
  };
}
