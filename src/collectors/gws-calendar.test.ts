import assert from "node:assert/strict";
import test from "node:test";

import { hashCalendarField } from "../calendar/signals.js";
import {
  createCalendarSignalRawEvent,
  diffActiveCalendarMeetings,
  filterActiveCalendarMeetings,
  getGWSCalendarCollectorStatus,
  listGWSCalendarMeetings,
} from "./gws-calendar.js";

test("getGWSCalendarCollectorStatus parses prefixed gws auth output", () => {
  const status = getGWSCalendarCollectorStatus({
    commandRunner: () => ({
      status: 0,
      stdout: `Using keyring backend: keyring
{
  "auth_method": "oauth2",
  "token_valid": true,
  "has_refresh_token": true,
  "user": "worker@example.com",
  "project_id": "ax-lab",
  "scopes": [
    "email",
    "https://www.googleapis.com/auth/calendar"
  ]
}`,
      stderr: "",
    }),
  });

  assert.equal(status.installed, true);
  assert.equal(status.ready, true);
  assert.equal(status.status, "available");
  assert.equal(status.user, "worker@example.com");
  assert.equal(status.calendarScopeGranted, true);
});

test("getGWSCalendarCollectorStatus reports a missing gws binary", () => {
  const missingBinaryError = Object.assign(new Error("spawnSync gws ENOENT"), {
    code: "ENOENT",
  });
  const status = getGWSCalendarCollectorStatus({
    commandRunner: () => ({
      status: null,
      stdout: "",
      stderr: "",
      error: missingBinaryError,
    }),
  });

  assert.equal(status.installed, false);
  assert.equal(status.ready, false);
  assert.equal(status.status, "missing_binary");
});

test("listGWSCalendarMeetings keeps only timed default meetings", () => {
  const meetings = listGWSCalendarMeetings({
    calendarId: "primary",
    timeMin: "2026-03-17T08:00:00.000Z",
    timeMax: "2026-03-17T12:00:00.000Z",
    commandRunner: () => ({
      status: 0,
      stderr: "",
      stdout: JSON.stringify({
        items: [
          {
            id: "meeting-1",
            summary: "Team Sync",
            eventType: "default",
            status: "confirmed",
            start: {
              dateTime: "2026-03-17T18:00:00+09:00",
            },
            end: {
              dateTime: "2026-03-17T18:30:00+09:00",
            },
            attendees: [{}, {}, {}],
          },
          {
            id: "focus-1",
            summary: "Focus Time",
            eventType: "focusTime",
            start: {
              dateTime: "2026-03-17T10:00:00.000Z",
            },
            end: {
              dateTime: "2026-03-17T11:00:00.000Z",
            },
          },
          {
            id: "all-day-1",
            summary: "Away",
            start: {
              date: "2026-03-17",
            },
            end: {
              date: "2026-03-18",
            },
          },
        ],
      }),
    }),
  });

  assert.deepEqual(meetings, [
    {
      id: "meeting-1",
      summary: "Team Sync",
      startAt: "2026-03-17T09:00:00.000Z",
      endAt: "2026-03-17T09:30:00.000Z",
      attendeesCount: 3,
    },
  ]);
});

test("calendar meeting helpers derive active transitions and privacy-safe signal events", () => {
  const previous = new Map([
    [
      "meeting-1",
      {
        id: "meeting-1",
        summary: "Daily standup",
        startAt: "2026-03-17T09:00:00.000Z",
        endAt: "2026-03-17T09:15:00.000Z",
        attendeesCount: 4,
      },
    ],
  ]);
  const currentMeetings = [
    {
      id: "meeting-2",
      summary: "Quarterly planning",
      startAt: "2026-03-17T09:10:00.000Z",
      endAt: "2026-03-17T10:00:00.000Z",
      attendeesCount: 7,
    },
  ];
  const activeNow = filterActiveCalendarMeetings(currentMeetings, "2026-03-17T09:20:00.000Z");
  const diff = diffActiveCalendarMeetings(previous, new Map(activeNow.map((meeting) => [meeting.id, meeting])));
  const signal = createCalendarSignalRawEvent({
    signalType: "meeting_start",
    meeting: currentMeetings[0]!,
  });

  assert.deepEqual(diff.started, currentMeetings);
  assert.deepEqual(diff.ended, [...previous.values()]);
  assert.equal(signal.source, "calendar");
  assert.equal(signal.target, "meeting_start");
  assert.deepEqual(signal.metadata, {
    calendarSignal: {
      signalType: "meeting_start",
      eventIdHash: hashCalendarField("meeting-2"),
      summaryHash: hashCalendarField("Quarterly planning"),
      startAt: "2026-03-17T09:10:00.000Z",
      endAt: "2026-03-17T10:00:00.000Z",
      attendeesCount: 7,
      signalOnly: true,
    },
  });
});
