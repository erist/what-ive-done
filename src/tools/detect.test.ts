import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  detectGh,
  detectGit,
  detectGitRepo,
  detectGws,
  detectOpenai,
  type DetectionResult,
} from "./detect.js";
import { createUnsupportedCredentialStore } from "../credentials/store.js";

function createExecRunner(
  handlers: Record<string, { status?: number | null; stdout?: string; stderr?: string; error?: Error }>,
) {
  return (command: string, args: string[]) => {
    const key = [command, ...args].join(" ");
    const result = handlers[key];

    if (!result) {
      throw new Error(`Unexpected command: ${key}`);
    }

    return {
      status: result.status ?? 0,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      error: result.error,
    };
  };
}

test("detectGws reports version and authenticated user when gws auth is ready", async () => {
  const detection = await detectGws({
    execRunner: createExecRunner({
      "gws --version": {
        stdout: "gws 0.13.2\n",
      },
      "gws auth status": {
        stdout: JSON.stringify({
          auth_method: "oauth2",
          has_refresh_token: true,
          project_id: "demo-project",
          scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
          token_valid: true,
          user: "tester@example.com",
        }),
      },
    }),
  });

  assert.deepEqual(detection, {
    name: "gws",
    available: true,
    authenticated: true,
    version: "0.13.2",
    details: "tester@example.com",
    installHint: undefined,
  } satisfies DetectionResult);
});

test("detectGit finds a parent repo and reports git version", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "what-ive-done-detect-git-"));
  const nestedDir = join(rootDir, "nested", "child");

  try {
    mkdirSync(join(rootDir, ".git"), { recursive: true });
    mkdirSync(nestedDir, { recursive: true });

    assert.equal(await detectGitRepo(nestedDir), rootDir);

    const detection = await detectGit(nestedDir, {
      execRunner: createExecRunner({
        "git --version": {
          stdout: "git version 2.44.0\n",
        },
      }),
    });

    assert.equal(detection.available, true);
    assert.equal(detection.authenticated, true);
    assert.equal(detection.version, "2.44.0");
    assert.equal(detection.details, rootDir);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("detectGh reports a missing binary without throwing", async () => {
  const missingBinaryError = Object.assign(new Error("spawnSync gh ENOENT"), {
    code: "ENOENT",
  });

  const detection = await detectGh({
    execRunner: createExecRunner({
      "gh --version": {
        status: null,
        error: missingBinaryError,
      },
    }),
  });

  assert.equal(detection.available, false);
  assert.equal(detection.authenticated, false);
  assert.match(detection.installHint ?? "", /GitHub CLI/iu);
});

test("detectOpenai falls back to environment hints when secure storage is unavailable", async () => {
  const detection = await detectOpenai({
    credentialStore: createUnsupportedCredentialStore(),
    env: {
      OPENAI_API_KEY: "sk-test",
    },
  });

  assert.equal(detection.available, true);
  assert.equal(detection.authenticated, true);
  assert.equal(detection.authMethod, "api-key");
  assert.match(detection.details ?? "", /OPENAI_API_KEY/iu);
});
