import { setTimeout as delay } from "node:timers/promises";

import {
  buildGitSnapshotFingerprint,
  createGitContextRawEvent,
  DEFAULT_GIT_CONTEXT_POLL_INTERVAL_MS,
  readGitRepoSnapshot,
} from "./git-context.js";

interface RunnerOptions {
  ingestUrl: string;
  ingestAuthToken?: string | undefined;
  repoPath: string;
  pollIntervalMs: number;
}

function parseRunnerOptions(argv: string[]): RunnerOptions {
  const options: RunnerOptions = {
    ingestUrl: "",
    repoPath: "",
    pollIntervalMs: DEFAULT_GIT_CONTEXT_POLL_INTERVAL_MS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const nextValue = argv[index + 1];

    if (arg === "--ingest-url") {
      if (!nextValue) {
        throw new Error("--ingest-url requires a value");
      }

      options.ingestUrl = nextValue;
      index += 1;
      continue;
    }

    if (arg === "--ingest-auth-token") {
      if (!nextValue) {
        throw new Error("--ingest-auth-token requires a value");
      }

      options.ingestAuthToken = nextValue;
      index += 1;
      continue;
    }

    if (arg === "--repo-path") {
      if (!nextValue) {
        throw new Error("--repo-path requires a value");
      }

      options.repoPath = nextValue;
      index += 1;
      continue;
    }

    if (arg === "--poll-interval-ms") {
      if (!nextValue) {
        throw new Error("--poll-interval-ms requires a value");
      }

      const pollIntervalMs = Number.parseInt(nextValue, 10);

      if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
        throw new Error(`Invalid poll interval: ${nextValue}`);
      }

      options.pollIntervalMs = pollIntervalMs;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.ingestUrl) {
    throw new Error("--ingest-url is required");
  }

  if (!options.repoPath) {
    throw new Error("--repo-path is required");
  }

  return options;
}

async function postRawEvent(
  ingestUrl: string,
  event: ReturnType<typeof createGitContextRawEvent>,
  ingestAuthToken?: string,
): Promise<void> {
  const response = await fetch(ingestUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(ingestAuthToken ? { authorization: `Bearer ${ingestAuthToken}` } : {}),
    },
    body: JSON.stringify(event),
  });

  if (!response.ok) {
    throw new Error(`Ingest rejected Git signal with status ${String(response.status)}`);
  }
}

async function main(): Promise<void> {
  const options = parseRunnerOptions(process.argv.slice(2));
  let stopped = false;
  let initialized = false;
  let previousFingerprint: string | undefined;
  let previousDirtyFileCount = 0;
  let previousCommitAt: string | undefined;
  let lastLoggedIssue: string | undefined;

  const stop = () => {
    stopped = true;
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  while (!stopped) {
    try {
      const snapshot = readGitRepoSnapshot(options.repoPath);
      const fingerprint = buildGitSnapshotFingerprint(snapshot);

      if (!initialized || previousFingerprint !== fingerprint) {
        const changeType =
          !initialized || snapshot.lastCommitAt !== previousCommitAt
            ? "commit"
            : snapshot.dirtyFileCount !== previousDirtyFileCount
              ? "status"
              : "commit";

        await postRawEvent(
          options.ingestUrl,
          createGitContextRawEvent({
            snapshot,
            changeType,
          }),
          options.ingestAuthToken,
        );
        previousFingerprint = fingerprint;
        previousDirtyFileCount = snapshot.dirtyFileCount;
        previousCommitAt = snapshot.lastCommitAt;
        initialized = true;
      }

      lastLoggedIssue = undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message !== lastLoggedIssue) {
        console.error(
          JSON.stringify(
            {
              collector: "git-context",
              level: "warn",
              timestamp: new Date().toISOString(),
              message,
            },
            null,
            2,
          ),
        );
        lastLoggedIssue = message;
      }
    }

    if (!stopped) {
      await delay(options.pollIntervalMs);
    }
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
