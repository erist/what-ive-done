import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { PassThrough } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";

import { buildManagedCollectorSpecs, startCollectorSupervisor, type SpawnedProcess } from "./collectors.js";

class FakeSpawnedProcess extends EventEmitter implements SpawnedProcess {
  pid?: number | undefined;
  stdout: NodeJS.ReadableStream | null = new PassThrough();
  stderr: NodeJS.ReadableStream | null = new PassThrough();

  constructor(pid?: number) {
    super();
    this.pid = pid;
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    const resolvedSignal = typeof signal === "string" ? signal : null;
    queueMicrotask(() => {
      this.emit("exit", 0, resolvedSignal);
    });
    return true;
  }
}

test("buildManagedCollectorSpecs maps darwin and win32 runtimes", () => {
  const darwinSpecs = buildManagedCollectorSpecs({
    ingestUrl: "http://127.0.0.1:4318/events",
    ingestAuthToken: "fixture-token",
    processPlatform: "darwin",
    pollIntervalMs: 250,
    promptAccessibility: true,
  });
  const windowsSpecs = buildManagedCollectorSpecs({
    ingestUrl: "http://127.0.0.1:4318/events",
    ingestAuthToken: "fixture-token",
    processPlatform: "win32",
    pollIntervalMs: 500,
  });

  assert.equal(darwinSpecs.length, 1);
  assert.equal(darwinSpecs[0]?.command, "swift");
  assert.deepEqual(darwinSpecs[0]?.args.slice(-7), [
    "--ingest-url",
    "http://127.0.0.1:4318/events",
    "--ingest-auth-token",
    "fixture-token",
    "--poll-interval-ms",
    "250",
    "--prompt-accessibility",
  ]);

  assert.equal(windowsSpecs.length, 1);
  assert.equal(windowsSpecs[0]?.command, "powershell.exe");
  assert.deepEqual(windowsSpecs[0]?.args.slice(-6), [
    "-IngestUrl",
    "http://127.0.0.1:4318/events",
    "-IngestAuthToken",
    "fixture-token",
    "-PollIntervalMs",
    "500",
  ]);
});

test("startCollectorSupervisor restarts a collector after an unexpected exit", async () => {
  const processes: FakeSpawnedProcess[] = [];
  const stateHistory: string[] = [];

  const supervisor = await startCollectorSupervisor({
    ingestUrl: "http://127.0.0.1:4318/events",
    processPlatform: "darwin",
    restartDelayMs: 10,
    spawnProcess: () => {
      const processHandle = new FakeSpawnedProcess(4_000 + processes.length);
      processes.push(processHandle);
      queueMicrotask(() => {
        processHandle.emit("spawn");
      });
      return processHandle;
    },
    onCollectorStateChange: (state) => {
      stateHistory.push(state.status);
    },
  });

  await delay(0);

  assert.equal(processes.length, 1);
  assert.equal(supervisor.getCollectorStates()[0]?.status, "running");

  processes[0]?.emit("exit", 1, null);

  await delay(30);

  assert.equal(processes.length, 2);
  assert.ok(stateHistory.includes("failed"));
  assert.ok(stateHistory.includes("restarting"));
  assert.equal(supervisor.getCollectorStates()[0]?.status, "running");

  await supervisor.stop();

  assert.equal(supervisor.getCollectorStates()[0]?.status, "stopped");
});

test("startCollectorSupervisor forwards macOS accessibility prompt configuration", async () => {
  let spawnedArgs: string[] = [];

  const supervisor = await startCollectorSupervisor({
    ingestUrl: "http://127.0.0.1:4318/events",
    processPlatform: "darwin",
    promptAccessibility: true,
    spawnProcess: (_command, args) => {
      spawnedArgs = args;
      const processHandle = new FakeSpawnedProcess(4_100);
      queueMicrotask(() => {
        processHandle.emit("spawn");
      });
      return processHandle;
    },
  });

  await delay(0);

  assert.ok(spawnedArgs.includes("--prompt-accessibility"));

  await supervisor.stop();
});

test("buildManagedCollectorSpecs adds the optional gws calendar collector when enabled", () => {
  const specs = buildManagedCollectorSpecs({
    ingestUrl: "http://127.0.0.1:4318/events",
    ingestAuthToken: "fixture-token",
    processPlatform: "linux",
    enableGWSCalendar: true,
    gwsCalendarId: "team-calendar@example.com",
    gwsCalendarPollIntervalMs: 45_000,
  });

  assert.equal(specs.length, 1);
  assert.equal(specs[0]?.id, "gws-calendar");
  assert.equal(specs[0]?.command, process.execPath);
  assert.deepEqual(specs[0]?.args.slice(-4), [
    "--calendar-id",
    "team-calendar@example.com",
    "--poll-interval-ms",
    "45000",
  ]);
});

test("buildManagedCollectorSpecs adds the optional workspace and git collectors when enabled", () => {
  const specs = buildManagedCollectorSpecs({
    ingestUrl: "http://127.0.0.1:4318/events",
    ingestAuthToken: "fixture-token",
    processPlatform: "linux",
    enableGWSDrive: true,
    gwsDrivePollIntervalMs: 30_000,
    enableGWSSheets: true,
    gwsSheetsPollIntervalMs: 45_000,
    gitRepoPath: "/tmp/example-repo",
    gitPollIntervalMs: 20_000,
  });

  assert.deepEqual(
    specs.map((spec) => spec.id),
    ["gws-drive", "gws-sheets", "git-context"],
  );
  assert.deepEqual(specs[0]?.args.slice(-2), ["--poll-interval-ms", "30000"]);
  assert.deepEqual(specs[1]?.args.slice(-2), ["--poll-interval-ms", "45000"]);
  assert.deepEqual(specs[2]?.args.slice(-4), [
    "--repo-path",
    "/tmp/example-repo",
    "--poll-interval-ms",
    "20000",
  ]);
});

test("startCollectorSupervisor returns no managed collectors on unsupported platforms", async () => {
  const supervisor = await startCollectorSupervisor({
    ingestUrl: "http://127.0.0.1:4318/events",
    processPlatform: "linux",
  });

  assert.deepEqual(supervisor.getCollectorStates(), []);

  await supervisor.stop();
});
