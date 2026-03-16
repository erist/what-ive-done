import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveAppPaths } from "../app-paths.js";
import { acquireAgentLock, AgentAlreadyRunningError, readAgentLock } from "./lock.js";
import { startAgentRuntime } from "./runtime.js";
import { getAgentStatusSnapshot } from "./state.js";
import type { AgentSnapshotSchedulerState } from "./types.js";

test("acquireAgentLock rejects when a live pid already owns the lock", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-agent-lock-"));
  const lockPath = join(tempDir, "agent.lock");
  const handle = acquireAgentLock(lockPath, {
    pid: process.pid,
    acquiredAt: "2026-03-14T00:00:00.000Z",
  });

  try {
    assert.throws(
      () =>
        acquireAgentLock(lockPath, {
          pid: process.pid + 1,
          acquiredAt: "2026-03-14T00:00:01.000Z",
        }),
      AgentAlreadyRunningError,
    );
  } finally {
    handle.release();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("acquireAgentLock reclaims a stale lock file", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-agent-stale-lock-"));
  const lockPath = join(tempDir, "agent.lock");

  try {
    writeFileSync(
      lockPath,
      JSON.stringify({
        pid: 999_999_999,
        acquiredAt: "2026-03-14T00:00:00.000Z",
      }),
    );

    const handle = acquireAgentLock(lockPath);
    const lock = readAgentLock(lockPath);

    assert.equal(lock?.pid, process.pid);

    handle.release();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("startAgentRuntime publishes heartbeat state and clears the lock on stop", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-agent-runtime-"));
  const paths = resolveAppPaths(tempDir);
  let ingestServerClosed = false;
  let collectorStopped = false;
  let snapshotSchedulerStopped = false;
  let promptAccessibility: boolean | undefined;

  try {
    const runtime = await startAgentRuntime({
      dataDir: tempDir,
      heartbeatIntervalMs: 20,
      handleSignals: false,
      promptAccessibility: true,
      ingestServerFactory: async () => ({
        host: "127.0.0.1",
        port: 4318,
        viewerUrl: "http://127.0.0.1:4318/",
        close: async () => {
          ingestServerClosed = true;
        },
      }),
      collectorSupervisorFactory: async ({ ingestUrl, onCollectorStateChange, promptAccessibility: prompt }) => {
        promptAccessibility = prompt;
        const collectorState = {
          id: "macos-active-window",
          platform: "macos",
          runtime: "swift",
          status: "running" as const,
          pid: 5678,
          ingestUrl,
          startedAt: "2026-03-14T00:00:00.000Z",
          restartCount: 0,
        };
        onCollectorStateChange?.(collectorState);

        return {
          getCollectorStates: () => [collectorState],
          stop: async () => {
            collectorStopped = true;
          },
        };
      },
      snapshotSchedulerFactory: async ({ onStateChange, windows, intervalMs }) => {
        let schedulerState: AgentSnapshotSchedulerState = {
          status: "running",
          windows: windows ?? ["day", "week"],
          intervalMs: intervalMs ?? 300_000,
          lastGeneratedSnapshots: [
            {
              window: "day" as const,
              reportDate: "2026-03-14",
              generatedAt: "2026-03-14T00:00:00.000Z",
            },
          ],
        };
        onStateChange?.(schedulerState);

        return {
          getState: () => schedulerState,
          runOnce: async () => schedulerState,
          stop: async () => {
            snapshotSchedulerStopped = true;
            schedulerState = {
              ...schedulerState,
              status: "stopped",
            };
            onStateChange?.(schedulerState);
          },
        };
      },
    });

    const initialStatus = getAgentStatusSnapshot(tempDir);

    assert.equal(initialStatus.status, "running");
    assert.equal(initialStatus.pid, runtime.pid);
    assert.equal(initialStatus.state?.ingestServer?.status, "running");
    assert.equal(initialStatus.state?.collectors[0]?.status, "running");
    assert.equal(initialStatus.state?.snapshotScheduler?.status, "running");
    assert.equal(promptAccessibility, true);
    assert.equal(
      initialStatus.state?.ingestServer?.eventsUrl,
      "http://127.0.0.1:4318/events",
    );
    assert.equal(
      initialStatus.state?.ingestServer?.viewerUrl,
      "http://127.0.0.1:4318/",
    );

    await runtime.stop("test");

    const stoppedStatus = getAgentStatusSnapshot(tempDir);

    assert.equal(stoppedStatus.status, "stopped");
    assert.equal(stoppedStatus.state?.stopReason, "test");
    assert.equal(stoppedStatus.state?.ingestServer?.status, "stopped");
    assert.equal(stoppedStatus.state?.snapshotScheduler?.status, "stopped");
    assert.equal(stoppedStatus.lock.exists, false);
    assert.equal(readAgentLock(paths.agentLockPath), undefined);
    assert.equal(ingestServerClosed, true);
    assert.equal(collectorStopped, true);
    assert.equal(snapshotSchedulerStopped, true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
