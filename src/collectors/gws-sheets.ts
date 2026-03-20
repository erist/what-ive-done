import { fileURLToPath } from "node:url";

import type { RawEventInput } from "../domain/types.js";
import type { CollectorInfo } from "./types.js";
import {
  buildGWSCollectorStatusBase,
  defaultGWSCommandRunner,
  describeCommandFailure,
  extractJsonPayload,
  hashOpaqueIdentifier,
  isMissingBinaryError,
  isRecord,
  normalizeIsoTimestamp,
  normalizeOptionalString,
  type GWSCommandRunner,
} from "./gws-shared.js";
import {
  DEFAULT_GWS_DRIVE_PAGE_SIZE,
  DEFAULT_GWS_DRIVE_LOOKBACK_MS,
  DEFAULT_GWS_DRIVE_POLL_INTERVAL_MS,
  buildDriveFileFingerprint,
  createDriveContextRawEvent,
  listRecentDriveFiles,
  resolveDriveActivity,
  type GWSDriveActivity,
  type GWSDriveFile,
} from "./gws-drive.js";

export const DEFAULT_GWS_SHEETS_POLL_INTERVAL_MS = DEFAULT_GWS_DRIVE_POLL_INTERVAL_MS;
export const DEFAULT_GWS_SHEETS_LOOKBACK_MS = DEFAULT_GWS_DRIVE_LOOKBACK_MS;
export const DEFAULT_GWS_SHEETS_PAGE_SIZE = DEFAULT_GWS_DRIVE_PAGE_SIZE;

export interface GWSSheetsCollectorStatus {
  collector: string;
  command: string;
  installed: boolean;
  ready: boolean;
  status: "available" | "auth_error" | "missing_binary" | "missing_scope";
  detail?: string | undefined;
  authMethod?: string | undefined;
  tokenValid?: boolean | undefined;
  hasRefreshToken?: boolean | undefined;
  user?: string | undefined;
  projectId?: string | undefined;
  sheetsScopeGranted?: boolean | undefined;
}

export interface SpreadsheetSummary {
  spreadsheetId: string;
  sheetCount: number;
  gridSheetCount: number;
}

function parseSpreadsheetSummary(output: string, spreadsheetId: string): SpreadsheetSummary {
  const payload = JSON.parse(extractJsonPayload(output, "spreadsheet summary"));
  const sheets = isRecord(payload) && Array.isArray(payload.sheets) ? payload.sheets : [];
  const gridSheetCount = sheets.filter((sheet) => {
    if (!isRecord(sheet) || !isRecord(sheet.properties)) {
      return false;
    }

    return normalizeOptionalString(sheet.properties.sheetType) === "GRID";
  }).length;

  return {
    spreadsheetId,
    sheetCount: sheets.length,
    gridSheetCount,
  };
}

export function getGWSSheetsCollectorInfo(): CollectorInfo {
  const currentFilePath = fileURLToPath(import.meta.url);
  const scriptPath = currentFilePath.replace(
    /gws-sheets\.(?:ts|js)$/u,
    `gws-sheets-runner${currentFilePath.endsWith(".ts") ? ".ts" : ".js"}`,
  );

  return {
    id: "gws-sheets",
    name: "gws Sheets Context Collector",
    platform: "cross-platform",
    runtime: "node",
    description:
      "Polls recent Google Sheets activity through the gws CLI and emits privacy-safe spreadsheet context to the local ingest server.",
    supportedEventTypes: ["workspace.sheets.modified", "workspace.sheets.viewed"],
    scriptPath,
  };
}

export function getGWSSheetsCollectorStatus(
  options: {
    commandRunner?: GWSCommandRunner | undefined;
  } = {},
): GWSSheetsCollectorStatus {
  const status = buildGWSCollectorStatusBase({
    collector: "gws-sheets",
    requiredScopes: ["https://www.googleapis.com/auth/spreadsheets"],
    missingScopeDetail: "gws auth is missing a Sheets scope",
    commandRunner: options.commandRunner,
  });

  return {
    ...status,
    sheetsScopeGranted: status.status !== "missing_scope",
  };
}

export function listRecentSpreadsheetFiles(
  options: {
    pageSize?: number | undefined;
    commandRunner?: GWSCommandRunner | undefined;
  } = {},
): GWSDriveFile[] {
  return listRecentDriveFiles({
    pageSize: options.pageSize ?? DEFAULT_GWS_SHEETS_PAGE_SIZE,
    query: "trashed=false and mimeType='application/vnd.google-apps.spreadsheet'",
    commandRunner: options.commandRunner,
  });
}

export function getSpreadsheetSummary(
  spreadsheetId: string,
  options: {
    commandRunner?: GWSCommandRunner | undefined;
  } = {},
): SpreadsheetSummary {
  const commandRunner = options.commandRunner ?? defaultGWSCommandRunner;
  const result = commandRunner([
    "sheets",
    "spreadsheets",
    "get",
    "--params",
    JSON.stringify({
      spreadsheetId,
      fields: "spreadsheetId,sheets.properties.sheetId,sheets.properties.sheetType",
    }),
  ]);

  if (isMissingBinaryError(result.error)) {
    throw new Error("gws CLI is not installed or not available on PATH");
  }

  if (result.status !== 0) {
    throw new Error(describeCommandFailure(result, "gws sheets spreadsheets get failed"));
  }

  return parseSpreadsheetSummary(result.stdout, spreadsheetId);
}

export function buildSpreadsheetFingerprint(
  file: GWSDriveFile,
  summary?: SpreadsheetSummary | undefined,
): string {
  return [buildDriveFileFingerprint(file), summary?.sheetCount ?? 0, summary?.gridSheetCount ?? 0].join(":");
}

export function createSheetsContextRawEvent(args: {
  file: GWSDriveFile;
  summary?: SpreadsheetSummary | undefined;
  activity?: GWSDriveActivity | undefined;
}): RawEventInput {
  const modifiedTime = normalizeIsoTimestamp(args.file.modifiedTime);
  const viewedByMeTime = normalizeIsoTimestamp(args.file.viewedByMeTime);
  const activity = args.activity
    ? {
        ...args.activity,
        observedAt: normalizeIsoTimestamp(args.activity.observedAt) ?? args.activity.observedAt,
      }
    : resolveDriveActivity({
        ...args.file,
        modifiedTime,
        viewedByMeTime,
      });
  const baseEvent = createDriveContextRawEvent({
    file: {
      ...args.file,
      modifiedTime,
      viewedByMeTime,
    },
    activity,
  });
  const itemHash = baseEvent.resourceHash!;

  return {
    ...baseEvent,
    sourceEventType: baseEvent.sourceEventType.replace("workspace.drive.", "workspace.sheets."),
    application: "gws-sheets",
    domain: "docs.google.com",
    target: baseEvent.target === "review_spreadsheet" ? "open_sheet" : "update_sheet",
    metadata: {
      workspaceContext: {
        provider: "gws",
        app: "sheets",
        itemType: "spreadsheet",
        itemHash,
        activityType: activity?.activityType ?? "modified",
        modifiedAt: modifiedTime,
        viewedAt: viewedByMeTime,
        sheetCount: args.summary?.sheetCount,
        gridSheetCount: args.summary?.gridSheetCount,
      },
    },
  };
}
