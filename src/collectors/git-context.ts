import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import type { RawEventInput } from "../domain/types.js";
import type { CollectorInfo } from "./types.js";
import { hashOpaqueIdentifier, normalizeIsoTimestamp, normalizeOptionalString } from "./gws-shared.js";

export const DEFAULT_GIT_CONTEXT_POLL_INTERVAL_MS = 30_000;

interface CommandRunnerResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error | undefined;
}

export interface GitCommandRunner {
  (
    args: string[],
    repoPath: string,
  ): CommandRunnerResult;
}

export interface GitContextCollectorStatus {
  collector: string;
  command: string;
  selectedRepoPath?: string | undefined;
  installed: boolean;
  ready: boolean;
  status: "available" | "missing_binary" | "not_configured" | "not_repo" | "error";
  detail?: string | undefined;
  repoHash?: string | undefined;
  remoteHost?: string | undefined;
  dirtyFileCount?: number | undefined;
  lastCommitAt?: string | undefined;
}

export interface GitRepoSnapshot {
  repoPath: string;
  repoHash: string;
  remoteHost?: string | undefined;
  dirtyFileCount: number;
  lastCommitAt?: string | undefined;
}

function defaultGitCommandRunner(args: string[], repoPath: string): CommandRunnerResult {
  const result = spawnSync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? undefined,
  };
}

function isMissingBinaryError(error: Error | undefined): boolean {
  const candidate = error as NodeJS.ErrnoException | undefined;

  return candidate?.code === "ENOENT";
}

function describeCommandFailure(result: CommandRunnerResult, fallback: string): string {
  if (result.error) {
    return result.error.message;
  }

  const detail = [result.stderr, result.stdout].find((value) => value.trim().length > 0);

  return detail?.trim() ?? fallback;
}

function parseRemoteHost(remoteUrl: string | undefined): string | undefined {
  const normalized = normalizeOptionalString(remoteUrl);

  if (!normalized) {
    return undefined;
  }

  const sshMatch = normalized.match(/^[^@]+@([^:]+):/u);

  if (sshMatch?.[1]) {
    return sshMatch[1].toLowerCase();
  }

  try {
    return new URL(normalized).host.toLowerCase();
  } catch {
    return undefined;
  }
}

function parseDirtyFileCount(output: string): number {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length;
}

export function getGitContextCollectorInfo(): CollectorInfo {
  const currentFilePath = fileURLToPath(import.meta.url);
  const scriptPath = currentFilePath.replace(
    /git-context\.(?:ts|js)$/u,
    `git-context-runner${currentFilePath.endsWith(".ts") ? ".ts" : ".js"}`,
  );

  return {
    id: "git-context",
    name: "Git Context Collector",
    platform: "cross-platform",
    runtime: "node",
    description:
      "Polls one local Git repository and emits privacy-safe repo hash and commit-timestamp context to the local ingest server.",
    supportedEventTypes: ["git.repo.commit", "git.repo.status"],
    scriptPath,
  };
}

export function readGitRepoSnapshot(
  repoPath: string,
  options: {
    commandRunner?: GitCommandRunner | undefined;
  } = {},
): GitRepoSnapshot {
  const commandRunner = options.commandRunner ?? defaultGitCommandRunner;
  const topLevelResult = commandRunner(["rev-parse", "--show-toplevel"], repoPath);

  if (isMissingBinaryError(topLevelResult.error)) {
    throw new Error("git is not installed or not available on PATH");
  }

  if (topLevelResult.status !== 0) {
    throw new Error(describeCommandFailure(topLevelResult, "git rev-parse failed"));
  }

  const topLevelPath = normalizeOptionalString(topLevelResult.stdout);

  if (!topLevelPath) {
    throw new Error("git did not return a repository root");
  }

  const statusResult = commandRunner(["status", "--porcelain"], topLevelPath);
  const lastCommitResult = commandRunner(["log", "-1", "--format=%cI"], topLevelPath);
  const remoteResult = commandRunner(["remote", "get-url", "origin"], topLevelPath);

  if (statusResult.status !== 0) {
    throw new Error(describeCommandFailure(statusResult, "git status failed"));
  }

  if (lastCommitResult.status !== 0) {
    throw new Error(describeCommandFailure(lastCommitResult, "git log failed"));
  }

  return {
    repoPath: topLevelPath,
    repoHash: hashOpaqueIdentifier(topLevelPath),
    remoteHost:
      remoteResult.status === 0 ? parseRemoteHost(remoteResult.stdout.trim()) : undefined,
    dirtyFileCount: parseDirtyFileCount(statusResult.stdout),
    lastCommitAt: normalizeIsoTimestamp(lastCommitResult.stdout.trim()),
  };
}

export function getGitContextCollectorStatus(
  options: {
    repoPath?: string | undefined;
    commandRunner?: GitCommandRunner | undefined;
  } = {},
): GitContextCollectorStatus {
  if (!options.repoPath) {
    return {
      collector: "git-context",
      command: "git",
      installed: true,
      ready: false,
      status: "not_configured",
      detail: "Set --git-repo to enable the Git context collector.",
    };
  }

  try {
    const snapshot = readGitRepoSnapshot(options.repoPath, {
      commandRunner: options.commandRunner,
    });

    return {
      collector: "git-context",
      command: "git",
      selectedRepoPath: snapshot.repoPath,
      installed: true,
      ready: true,
      status: "available",
      repoHash: snapshot.repoHash,
      remoteHost: snapshot.remoteHost,
      dirtyFileCount: snapshot.dirtyFileCount,
      lastCommitAt: snapshot.lastCommitAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (/not available on PATH/u.test(message)) {
      return {
        collector: "git-context",
        command: "git",
        selectedRepoPath: options.repoPath,
        installed: false,
        ready: false,
        status: "missing_binary",
        detail: message,
      };
    }

    return {
      collector: "git-context",
      command: "git",
      selectedRepoPath: options.repoPath,
      installed: true,
      ready: false,
      status: /not a git repository/u.test(message) ? "not_repo" : "error",
      detail: message,
    };
  }
}

export function buildGitSnapshotFingerprint(snapshot: GitRepoSnapshot): string {
  return [snapshot.repoHash, snapshot.lastCommitAt ?? "", snapshot.dirtyFileCount].join(":");
}

export function createGitContextRawEvent(args: {
  snapshot: GitRepoSnapshot;
  changeType: "commit" | "status";
  timestamp?: string | undefined;
}): RawEventInput {
  return {
    source: "git",
    sourceEventType: `git.repo.${args.changeType}`,
    timestamp: args.timestamp ?? args.snapshot.lastCommitAt ?? new Date().toISOString(),
    application: "git",
    domain: args.snapshot.remoteHost,
    resourceHash: args.snapshot.repoHash,
    action: "git_activity",
    target:
      args.changeType === "commit"
        ? "record_git_commit"
        : args.snapshot.dirtyFileCount > 0
          ? "review_git_changes"
          : "sync_git_repo",
    metadata: {
      gitContext: {
        repoHash: args.snapshot.repoHash,
        remoteHost: args.snapshot.remoteHost,
        dirtyFileCount: args.snapshot.dirtyFileCount,
        lastCommitAt: args.snapshot.lastCommitAt,
      },
    },
  };
}
