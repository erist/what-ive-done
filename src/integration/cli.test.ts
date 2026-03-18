import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const cliEntrypoint = fileURLToPath(new URL("../cli.ts", import.meta.url));
const tsxBinary = join(
  repoRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tsx.cmd" : "tsx",
);

function runCli(args: string[], cwd: string): string {
  return execFileSync(tsxBinary, [cliEntrypoint, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
    },
  });
}

test("init creates .wid config and config commands discover it from parent directories", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "what-ive-done-cli-config-"));
  const nestedDir = join(dataDir, "nested", "child");
  const resolvedDataDir = resolve(dataDir);
  const realDataDir = realpathSync(dataDir);

  try {
    mkdirSync(nestedDir, { recursive: true });

    const initPayload = JSON.parse(runCli(["init", "--data-dir", dataDir], repoRoot)) as {
      configPath: string;
      databasePath: string;
    };

    assert.equal(initPayload.configPath, join(resolvedDataDir, ".wid", "config.json"));
    assert.equal(initPayload.databasePath, join(resolvedDataDir, "what-ive-done.sqlite"));

    assert.equal(
      runCli(["config", "set", "server.port", "4319"], nestedDir).trim(),
      "4319",
    );
    assert.equal(runCli(["config", "get", "server.port"], nestedDir).trim(), "4319");
    assert.equal(
      realpathSync(runCli(["config", "path"], nestedDir).trim()),
      realpathSync(join(dataDir, ".wid", "config.json")),
    );

    const shownConfig = JSON.parse(runCli(["config", "show"], nestedDir)) as {
      server: { port: number };
      dataDir: string;
    };

    assert.equal(shownConfig.server.port, 4319);
    assert.equal(shownConfig.dataDir, realDataDir);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("agent:run remains compatible with the explicit --data-dir flow", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "what-ive-done-cli-agent-run-"));

  try {
    runCli(["init", "--data-dir", dataDir], repoRoot);

    const child = spawn(
      tsxBinary,
      [
        cliEntrypoint,
        "agent:run",
        "--data-dir",
        dataDir,
        "--no-collectors",
        "--no-snapshot-scheduler",
        "--ingest-port",
        "0",
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out waiting for agent:run output.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
      }, 15_000);

      child.stdout.on("data", () => {
        if (stdout.includes('"status": "running"')) {
          clearTimeout(timeout);
          resolve();
        }
      });

      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      child.on("exit", (code) => {
        if (!stdout.includes('"status": "running"')) {
          clearTimeout(timeout);
          reject(new Error(`agent:run exited before startup. code=${String(code)} stderr=${stderr}`));
        }
      });
    });

    child.kill("SIGTERM");

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out waiting for agent:run to stop.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
      }, 15_000);

      child.on("exit", (code) => {
        clearTimeout(timeout);
        resolve(code);
      });

      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    assert.equal(exitCode, 0);

    const payload = JSON.parse(stdout) as {
      status: string;
      state?: {
        ingestServer?: {
          status?: string;
        };
      };
    };

    assert.equal(payload.status, "running");
    assert.equal(payload.state?.ingestServer?.status, "running");
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
