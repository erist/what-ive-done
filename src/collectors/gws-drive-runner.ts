import { setTimeout as delay } from "node:timers/promises";

import {
  buildDriveFileFingerprint,
  createDriveContextRawEvent,
  DEFAULT_GWS_DRIVE_LOOKBACK_MS,
  DEFAULT_GWS_DRIVE_POLL_INTERVAL_MS,
  listRecentDriveFiles,
  resolveDriveActivity,
} from "./gws-drive.js";

interface RunnerOptions {
  ingestUrl: string;
  ingestAuthToken?: string | undefined;
  pollIntervalMs: number;
  lookbackMs: number;
}

function parseRunnerOptions(argv: string[]): RunnerOptions {
  const options: RunnerOptions = {
    ingestUrl: "",
    pollIntervalMs: DEFAULT_GWS_DRIVE_POLL_INTERVAL_MS,
    lookbackMs: DEFAULT_GWS_DRIVE_LOOKBACK_MS,
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

    if (arg === "--lookback-ms") {
      if (!nextValue) {
        throw new Error("--lookback-ms requires a value");
      }

      const lookbackMs = Number.parseInt(nextValue, 10);

      if (!Number.isFinite(lookbackMs) || lookbackMs <= 0) {
        throw new Error(`Invalid lookback: ${nextValue}`);
      }

      options.lookbackMs = lookbackMs;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.ingestUrl) {
    throw new Error("--ingest-url is required");
  }

  return options;
}

async function postRawEvent(
  ingestUrl: string,
  event: ReturnType<typeof createDriveContextRawEvent>,
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
    throw new Error(`Ingest rejected Drive signal with status ${String(response.status)}`);
  }
}

async function main(): Promise<void> {
  const options = parseRunnerOptions(process.argv.slice(2));
  const seenFingerprints = new Map<string, string>();
  let stopped = false;
  let lastLoggedIssue: string | undefined;

  const stop = () => {
    stopped = true;
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  while (!stopped) {
    try {
      const recentThreshold = Date.now() - options.lookbackMs;
      const files = listRecentDriveFiles();

      for (const file of files) {
        const activity = resolveDriveActivity(file);

        if (!activity || Date.parse(activity.observedAt) < recentThreshold) {
          continue;
        }

        const fingerprint = buildDriveFileFingerprint(file);
        const previousFingerprint = seenFingerprints.get(file.id);

        if (previousFingerprint === fingerprint) {
          continue;
        }

        await postRawEvent(
          options.ingestUrl,
          createDriveContextRawEvent({
            file,
            activity,
          }),
          options.ingestAuthToken,
        );
        seenFingerprints.set(file.id, fingerprint);
      }

      lastLoggedIssue = undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message !== lastLoggedIssue) {
        console.error(
          JSON.stringify(
            {
              collector: "gws-drive",
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
