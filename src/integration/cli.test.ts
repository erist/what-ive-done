import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

function runCli(args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  return execFileSync(tsxBinary, [cliEntrypoint, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...env,
    },
  });
}

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content, "utf8");
  chmodSync(path, 0o755);
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
      authTokenPreview: string;
    };

    assert.equal(initPayload.configPath, join(resolvedDataDir, ".wid", "config.json"));
    assert.equal(initPayload.databasePath, join(resolvedDataDir, "what-ive-done.sqlite"));
    assert.match(initPayload.authTokenPreview, /\.\.\./u);

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

test("init --interactive applies detected collector defaults and creates an ingest token", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-cli-init-interactive-"));
  const fakeBinDir = join(tempDir, "bin");
  const repoDir = join(tempDir, "workspace", "repo");
  const dataDir = join(tempDir, "agent-data");
  const env = {
    ...process.env,
    PATH: `${fakeBinDir}:${dirname(process.execPath)}`,
  };

  try {
    mkdirSync(fakeBinDir, { recursive: true });
    mkdirSync(join(repoDir, ".git"), { recursive: true });

    writeExecutable(
      join(fakeBinDir, "gws"),
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "gws 0.13.2"
  exit 0
fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  cat <<'EOF'
{"auth_method":"oauth2","has_refresh_token":true,"project_id":"demo-project","scopes":["https://www.googleapis.com/auth/calendar.readonly"],"token_valid":true,"user":"tester@example.com"}
EOF
  exit 0
fi
echo "unexpected gws args: $@" >&2
exit 1
`,
    );
    writeExecutable(
      join(fakeBinDir, "git"),
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "git version 2.44.0"
  exit 0
fi
echo "unexpected git args: $@" >&2
exit 1
`,
    );

    const child = spawn(
      tsxBinary,
      [cliEntrypoint, "init", "--data-dir", dataDir, "--interactive"],
      {
        cwd: repoDir,
        env,
        stdio: ["pipe", "pipe", "pipe"],
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
    const scriptedAnswers: Array<{ pattern: string; answer: string }> = [
      { pattern: "Step 1: Data directory", answer: "\n" },
      { pattern: "Add gws context collector?", answer: "y\n" },
      { pattern: "Add git context collector?", answer: "y\n" },
      { pattern: "Git repo path", answer: "\n" },
      { pattern: "Set a default LLM from already available credentials?", answer: "\n" },
      { pattern: "Configure a new LLM credential now?", answer: "\n" },
    ];

    child.stdout.on("data", () => {
      while (scriptedAnswers.length > 0 && stdout.includes(scriptedAnswers[0]?.pattern ?? "")) {
        const next = scriptedAnswers.shift();

        if (!next) {
          break;
        }

        child.stdin.write(next.answer);

        if (scriptedAnswers.length === 0) {
          child.stdin.end();
        }
      }
    });

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out waiting for init --interactive.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
      }, 20_000);

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
    assert.match(stdout, /Setup complete/u);

    const config = JSON.parse(
      runCli(["config", "show", "--data-dir", dataDir], repoRoot, env),
    ) as {
      tools: {
        gws?: { added?: boolean; "calendar-id"?: string };
        git?: { added?: boolean; "repo-path"?: string };
      };
    };
    const tokenPayload = JSON.parse(
      runCli(["ingest:token", "--data-dir", dataDir], repoRoot, env),
    ) as {
      configured: boolean;
      authToken: string;
    };

    assert.equal(config.tools.gws?.added, true);
    assert.equal(config.tools.gws?.["calendar-id"], "primary");
    assert.equal(config.tools.git?.added, true);
    assert.equal(
      realpathSync(config.tools.git?.["repo-path"] ?? ""),
      realpathSync(repoDir),
    );
    assert.equal(tokenPayload.configured, true);
    assert.match(tokenPayload.authToken, /^[A-Za-z0-9_-]{20,}$/u);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("tools add configures collectors and tools prints their managed status", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-cli-tools-"));
  const fakeBinDir = join(tempDir, "bin");
  const repoDir = join(tempDir, "workspace", "repo");
  const dataDir = join(tempDir, "agent-data");
  const env = {
    ...process.env,
    PATH: `${fakeBinDir}:${dirname(process.execPath)}`,
  };

  try {
    mkdirSync(fakeBinDir, { recursive: true });
    mkdirSync(join(repoDir, ".git"), { recursive: true });

    writeExecutable(
      join(fakeBinDir, "gws"),
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "gws 0.13.2"
  exit 0
fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  cat <<'EOF'
{"auth_method":"oauth2","has_refresh_token":true,"project_id":"demo-project","scopes":["https://www.googleapis.com/auth/calendar.readonly","https://www.googleapis.com/auth/drive","https://www.googleapis.com/auth/spreadsheets"],"token_valid":true,"user":"tester@example.com"}
EOF
  exit 0
fi
echo "unexpected gws args: $@" >&2
exit 1
`,
    );
    writeExecutable(
      join(fakeBinDir, "git"),
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "git version 2.44.0"
  exit 0
fi
if [ "$1" = "-C" ] && [ "$3" = "rev-parse" ]; then
  echo "$2"
  exit 0
fi
if [ "$1" = "-C" ] && [ "$3" = "status" ]; then
  exit 0
fi
if [ "$1" = "-C" ] && [ "$3" = "log" ]; then
  echo "2026-03-18T00:00:00.000Z"
  exit 0
fi
if [ "$1" = "-C" ] && [ "$3" = "remote" ]; then
  echo "git@github.com:erist/what-ive-done.git"
  exit 0
fi
echo "unexpected git args: $@" >&2
exit 1
`,
    );

    runCli(["init", "--data-dir", dataDir], repoRoot, env);

    assert.match(
      runCli(["tools", "add", "gws", "--data-dir", dataDir], repoRoot, env),
      /Added gws collector/u,
    );
    assert.match(
      runCli(["tools", "add", "git", "--data-dir", dataDir, "--repo-path", repoDir], repoRoot, env),
      /Added git collector/u,
    );

    const toolsOutput = runCli(["tools", "list", "--data-dir", dataDir], repoRoot, env);
    const config = JSON.parse(
      runCli(["config", "show", "--data-dir", dataDir], repoRoot, env),
    ) as {
      tools: {
        gws?: { added?: boolean };
        git?: { added?: boolean; "repo-path"?: string };
      };
    };

    assert.match(toolsOutput, /COLLECTORS/u);
    assert.match(toolsOutput, /\bgws\b/u);
    assert.match(toolsOutput, /✓ git/u);
    assert.equal(config.tools.gws?.added, true);
    assert.equal(config.tools.git?.added, true);
    assert.equal(realpathSync(config.tools.git?.["repo-path"] ?? ""), realpathSync(repoDir));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
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
