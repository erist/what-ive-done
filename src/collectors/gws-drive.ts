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

export const DEFAULT_GWS_DRIVE_POLL_INTERVAL_MS = 120_000;
export const DEFAULT_GWS_DRIVE_LOOKBACK_MS = 15 * 60 * 1000;
export const DEFAULT_GWS_DRIVE_PAGE_SIZE = 25;

export type WorkspaceActivityType = "modified" | "viewed";
export type WorkspaceItemType =
  | "spreadsheet"
  | "document"
  | "presentation"
  | "pdf"
  | "folder"
  | "file";

export interface GWSDriveCollectorStatus {
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
  driveScopeGranted?: boolean | undefined;
}

export interface GWSDriveFile {
  id: string;
  mimeType: string;
  modifiedTime?: string | undefined;
  viewedByMeTime?: string | undefined;
}

export interface GWSDriveActivity {
  activityType: WorkspaceActivityType;
  observedAt: string;
}

function parseDriveFilesPayload(output: string): GWSDriveFile[] {
  const payload = JSON.parse(extractJsonPayload(output, "drive files list"));
  const items = isRecord(payload) && Array.isArray(payload.files) ? payload.files : [];
  const files: GWSDriveFile[] = [];

  for (const item of items) {
    if (!isRecord(item)) {
      continue;
    }

    const id = normalizeOptionalString(item.id);
    const mimeType = normalizeOptionalString(item.mimeType);

    if (!id || !mimeType) {
      continue;
    }

    files.push({
      id,
      mimeType,
      modifiedTime: normalizeIsoTimestamp(item.modifiedTime),
      viewedByMeTime: normalizeIsoTimestamp(item.viewedByMeTime),
    });
  }

  return files;
}

export function getGWSDriveCollectorInfo(): CollectorInfo {
  const currentFilePath = fileURLToPath(import.meta.url);
  const scriptPath = currentFilePath.replace(
    /gws-drive\.(?:ts|js)$/u,
    `gws-drive-runner${currentFilePath.endsWith(".ts") ? ".ts" : ".js"}`,
  );

  return {
    id: "gws-drive",
    name: "gws Drive Context Collector",
    platform: "cross-platform",
    runtime: "node",
    description:
      "Polls Google Drive through the gws CLI and emits privacy-safe recent Drive file activity to the local ingest server.",
    supportedEventTypes: ["workspace.drive.modified", "workspace.drive.viewed"],
    scriptPath,
  };
}

export function getGWSDriveCollectorStatus(
  options: {
    commandRunner?: GWSCommandRunner | undefined;
  } = {},
): GWSDriveCollectorStatus {
  const status = buildGWSCollectorStatusBase({
    collector: "gws-drive",
    requiredScopes: ["https://www.googleapis.com/auth/drive"],
    missingScopeDetail: "gws auth is missing a Drive scope",
    commandRunner: options.commandRunner,
  });

  return {
    ...status,
    driveScopeGranted: status.status !== "missing_scope",
  };
}

export function listRecentDriveFiles(
  options: {
    pageSize?: number | undefined;
    query?: string | undefined;
    commandRunner?: GWSCommandRunner | undefined;
  } = {},
): GWSDriveFile[] {
  const commandRunner = options.commandRunner ?? defaultGWSCommandRunner;
  const result = commandRunner([
    "drive",
    "files",
    "list",
    "--params",
    JSON.stringify({
      pageSize: options.pageSize ?? DEFAULT_GWS_DRIVE_PAGE_SIZE,
      orderBy: "modifiedTime desc,viewedByMeTime desc",
      q:
        options.query ??
        "trashed=false and mimeType!='application/vnd.google-apps.spreadsheet'",
      fields: "files(id,mimeType,modifiedTime,viewedByMeTime)",
    }),
  ]);

  if (isMissingBinaryError(result.error)) {
    throw new Error("gws CLI is not installed or not available on PATH");
  }

  if (result.status !== 0) {
    throw new Error(describeCommandFailure(result, "gws drive files list failed"));
  }

  return parseDriveFilesPayload(result.stdout);
}

export function classifyDriveItemType(mimeType: string): WorkspaceItemType {
  if (mimeType === "application/vnd.google-apps.spreadsheet") {
    return "spreadsheet";
  }

  if (mimeType === "application/vnd.google-apps.document") {
    return "document";
  }

  if (mimeType === "application/vnd.google-apps.presentation") {
    return "presentation";
  }

  if (mimeType === "application/vnd.google-apps.folder") {
    return "folder";
  }

  if (mimeType === "application/pdf") {
    return "pdf";
  }

  return "file";
}

export function resolveDriveActivity(file: GWSDriveFile): GWSDriveActivity | undefined {
  const modifiedAt = file.modifiedTime ? Date.parse(file.modifiedTime) : Number.NaN;
  const viewedAt = file.viewedByMeTime ? Date.parse(file.viewedByMeTime) : Number.NaN;

  if (!Number.isNaN(viewedAt) && (Number.isNaN(modifiedAt) || viewedAt >= modifiedAt)) {
    return {
      activityType: "viewed",
      observedAt: file.viewedByMeTime!,
    };
  }

  if (!Number.isNaN(modifiedAt)) {
    return {
      activityType: "modified",
      observedAt: file.modifiedTime!,
    };
  }

  return undefined;
}

export function buildDriveFileFingerprint(file: GWSDriveFile): string {
  return [
    hashOpaqueIdentifier(file.id),
    file.modifiedTime ?? "",
    file.viewedByMeTime ?? "",
  ].join(":");
}

export function createDriveContextRawEvent(args: {
  file: GWSDriveFile;
  activity?: GWSDriveActivity | undefined;
}): RawEventInput {
  const activity = args.activity ?? resolveDriveActivity(args.file);
  const itemType = classifyDriveItemType(args.file.mimeType);
  const itemHash = hashOpaqueIdentifier(args.file.id);
  const observedAt = activity?.observedAt ?? args.file.modifiedTime ?? args.file.viewedByMeTime ?? new Date().toISOString();
  const activityType = activity?.activityType ?? "modified";

  return {
    source: "workspace",
    sourceEventType: `workspace.drive.${activityType}`,
    timestamp: observedAt,
    application: "gws-drive",
    domain: "drive.google.com",
    resourceHash: itemHash,
    action: "workspace_activity",
    target: activityType === "viewed" ? `review_${itemType}` : `update_${itemType}`,
    metadata: {
      workspaceContext: {
        provider: "gws",
        app: "drive",
        itemType,
        itemHash,
        activityType,
        modifiedAt: args.file.modifiedTime,
        viewedAt: args.file.viewedByMeTime,
      },
    },
  };
}
