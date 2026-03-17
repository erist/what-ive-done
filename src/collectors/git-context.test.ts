import assert from "node:assert/strict";
import test from "node:test";

import {
  createGitContextRawEvent,
  getGitContextCollectorStatus,
  readGitRepoSnapshot,
} from "./git-context.js";

test("getGitContextCollectorStatus reports an unconfigured collector", () => {
  const status = getGitContextCollectorStatus();

  assert.equal(status.status, "not_configured");
  assert.equal(status.ready, false);
});

test("readGitRepoSnapshot parses git repo state", () => {
  const calls: string[] = [];
  const snapshot = readGitRepoSnapshot("/tmp/example-repo", {
    commandRunner: (args) => {
      calls.push(args.join(" "));

      if (args[0] === "rev-parse") {
        return {
          status: 0,
          stdout: "/tmp/example-repo\n",
          stderr: "",
        };
      }

      if (args[0] === "status") {
        return {
          status: 0,
          stdout: " M src/index.ts\n?? docs/note.md\n",
          stderr: "",
        };
      }

      if (args[0] === "log") {
        return {
          status: 0,
          stdout: "2026-03-17T09:45:00.000Z\n",
          stderr: "",
        };
      }

      if (args[0] === "remote") {
        return {
          status: 0,
          stdout: "git@github.com:erist/what-ive-done.git\n",
          stderr: "",
        };
      }

      throw new Error(`Unexpected git command: ${args.join(" ")}`);
    },
  });

  assert.ok(calls.includes("rev-parse --show-toplevel"));
  assert.equal(snapshot.remoteHost, "github.com");
  assert.equal(snapshot.dirtyFileCount, 2);
  assert.equal(snapshot.lastCommitAt, "2026-03-17T09:45:00.000Z");
  assert.ok(snapshot.repoHash);
});

test("createGitContextRawEvent builds privacy-safe repo context events", () => {
  const event = createGitContextRawEvent({
    snapshot: {
      repoPath: "/tmp/example-repo",
      repoHash: "abc123def4567890abc123def4567890abc123def4567890abc123def4567890",
      remoteHost: "github.com",
      dirtyFileCount: 2,
      lastCommitAt: "2026-03-17T09:45:00.000Z",
    },
    changeType: "status",
  });

  assert.equal(event.source, "git");
  assert.equal(event.application, "git");
  assert.equal(event.target, "review_git_changes");
  assert.ok(event.metadata);
  assert.deepEqual(event.metadata.gitContext, {
    repoHash: "abc123def4567890abc123def4567890abc123def4567890abc123def4567890",
    remoteHost: "github.com",
    dirtyFileCount: 2,
    lastCommitAt: "2026-03-17T09:45:00.000Z",
  });
});
