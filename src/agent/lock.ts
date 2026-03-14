import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

export interface AgentLockPayload {
  pid: number;
  acquiredAt: string;
}

export interface AgentLockHandle {
  readonly lockPath: string;
  readonly payload: AgentLockPayload;
  release: () => void;
}

export class AgentAlreadyRunningError extends Error {
  readonly pid: number;

  constructor(pid: number, lockPath: string) {
    super(`Agent is already running with pid ${pid} (${lockPath})`);
    this.name = "AgentAlreadyRunningError";
    this.pid = pid;
  }
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "ESRCH" || error.code === "EPERM")
    ) {
      return error.code === "EPERM";
    }

    throw error;
  }
}

export function readAgentLock(lockPath: string): AgentLockPayload | undefined {
  try {
    const raw = readFileSync(lockPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<AgentLockPayload>;

    if (typeof parsed.pid !== "number" || typeof parsed.acquiredAt !== "string") {
      return undefined;
    }

    return {
      pid: parsed.pid,
      acquiredAt: parsed.acquiredAt,
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

export function acquireAgentLock(
  lockPath: string,
  payload: AgentLockPayload = {
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
  },
): AgentLockHandle {
  const existing = readAgentLock(lockPath);

  if (existing) {
    if (isProcessRunning(existing.pid)) {
      throw new AgentAlreadyRunningError(existing.pid, lockPath);
    }

    unlinkSync(lockPath);
  }

  let fd: number | undefined;

  try {
    fd = openSync(lockPath, "wx");
    writeFileSync(fd, JSON.stringify(payload, null, 2));
  } catch (error) {
    if (fd !== undefined) {
      closeSync(fd);
    }

    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      const lock = readAgentLock(lockPath);

      if (lock && isProcessRunning(lock.pid)) {
        throw new AgentAlreadyRunningError(lock.pid, lockPath);
      }

      unlinkSync(lockPath);
      return acquireAgentLock(lockPath, payload);
    }

    throw error;
  }

  if (fd !== undefined) {
    closeSync(fd);
  }

  let released = false;

  return {
    lockPath,
    payload,
    release: () => {
      if (released) {
        return;
      }

      released = true;

      try {
        const current = readAgentLock(lockPath);

        if (current?.pid === payload.pid && current.acquiredAt === payload.acquiredAt) {
          unlinkSync(lockPath);
        }
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
          return;
        }

        throw error;
      }
    },
  };
}
