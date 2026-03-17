import { setTimeout as delay } from "node:timers/promises";

import type { GWSCalendarMeeting } from "./gws-calendar.js";
import {
  buildCalendarPollingWindow,
  createCalendarSignalRawEvent,
  DEFAULT_GWS_CALENDAR_ID,
  DEFAULT_GWS_CALENDAR_POLL_INTERVAL_MS,
  diffActiveCalendarMeetings,
  filterActiveCalendarMeetings,
  listGWSCalendarMeetings,
} from "./gws-calendar.js";

interface RunnerOptions {
  ingestUrl: string;
  ingestAuthToken?: string | undefined;
  calendarId: string;
  pollIntervalMs: number;
}

function parseRunnerOptions(argv: string[]): RunnerOptions {
  const options: RunnerOptions = {
    ingestUrl: "",
    calendarId: DEFAULT_GWS_CALENDAR_ID,
    pollIntervalMs: DEFAULT_GWS_CALENDAR_POLL_INTERVAL_MS,
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

    if (arg === "--calendar-id") {
      if (!nextValue) {
        throw new Error("--calendar-id requires a value");
      }

      options.calendarId = nextValue;
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

  return options;
}

async function postRawEvent(
  ingestUrl: string,
  event: ReturnType<typeof createCalendarSignalRawEvent>,
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
    throw new Error(`Ingest rejected calendar signal with status ${String(response.status)}`);
  }
}

function toMeetingMap(meetings: GWSCalendarMeeting[]): Map<string, GWSCalendarMeeting> {
  return new Map(meetings.map((meeting) => [meeting.id, meeting]));
}

async function main(): Promise<void> {
  const options = parseRunnerOptions(process.argv.slice(2));
  let stopped = false;
  let initialized = false;
  let activeMeetings = new Map<string, GWSCalendarMeeting>();
  let lastLoggedIssue: string | undefined;

  const stop = () => {
    stopped = true;
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  while (!stopped) {
    try {
      const window = buildCalendarPollingWindow();
      const meetings = listGWSCalendarMeetings({
        calendarId: options.calendarId,
        timeMin: window.timeMin,
        timeMax: window.timeMax,
      });
      const currentActiveMeetings = toMeetingMap(
        filterActiveCalendarMeetings(meetings, new Date().toISOString()),
      );

      if (!initialized) {
        activeMeetings = currentActiveMeetings;
        initialized = true;
        lastLoggedIssue = undefined;
      } else {
        const diff = diffActiveCalendarMeetings(activeMeetings, currentActiveMeetings);

        for (const meeting of diff.started) {
          await postRawEvent(
            options.ingestUrl,
            createCalendarSignalRawEvent({
              signalType: "meeting_start",
              meeting,
            }),
            options.ingestAuthToken,
          );
          activeMeetings.set(meeting.id, meeting);
        }

        for (const meeting of diff.ended) {
          await postRawEvent(
            options.ingestUrl,
            createCalendarSignalRawEvent({
              signalType: "meeting_end",
              meeting,
            }),
            options.ingestAuthToken,
          );
          activeMeetings.delete(meeting.id);
        }

        activeMeetings = currentActiveMeetings;
        lastLoggedIssue = undefined;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message !== lastLoggedIssue) {
        console.error(
          JSON.stringify(
            {
              collector: "gws-calendar",
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
