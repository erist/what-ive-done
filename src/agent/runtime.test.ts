import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { resolveAppPaths } from "../app-paths.js";
import { acquireAgentLock, AgentAlreadyRunningError, readAgentLock } from "./lock.js";
import { startAgentRuntime } from "./runtime.js";
import { getAgentStatusSnapshot } from "./state.js";

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

  try {
    const runtime = await startAgentRuntime({
      dataDir: tempDir,
      heartbeatIntervalMs: 20,
      handleSignals: false,
    });

    const initialStatus = getAgentStatusSnapshot(tempDir);

    assert.equal(initialStatus.status, "running");
    assert.equal(initialStatus.pid, runtime.pid);

    await delay(40);

    const heartbeatStatus = getAgentStatusSnapshot(tempDir);

    assert.equal(heartbeatStatus.status, "running");
    assert.ok(heartbeatStatus.state);
    assert.notEqual(heartbeatStatus.state.heartbeatAt, heartbeatStatus.state.startedAt);

    await runtime.stop("test");

    const stoppedStatus = getAgentStatusSnapshot(tempDir);

    assert.equal(stoppedStatus.status, "stopped");
    assert.equal(stoppedStatus.state?.stopReason, "test");
    assert.equal(stoppedStatus.lock.exists, false);
    assert.equal(readAgentLock(paths.agentLockPath), undefined);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
