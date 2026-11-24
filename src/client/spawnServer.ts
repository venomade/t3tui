import { mkdirSync, openSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { configDir, t3Command } from "./auth.ts";

const t3Home = () => process.env.T3CODE_HOME ?? join(homedir(), ".t3");
const runtimePath = () => join(t3Home(), "userdata", "server-runtime.json");

export interface SpawnedServer {
  /** The origin the spawned server came up on. */
  readonly origin: string;
  /** Stops the server and its process group, if t3tui started it. */
  stop(): Promise<void>;
}

/** The origin the runtime file names, or null when there is no runtime file. */
async function localOrigin(): Promise<string | null> {
  try {
    const runtime = JSON.parse(await readFile(runtimePath(), "utf8")) as { origin?: string; port?: number };
    return runtime.origin ?? (runtime.port != null ? `http://127.0.0.1:${runtime.port}` : null);
  } catch {
    return null;
  }
}

/** True when something answers HTTP at the origin — the runtime file alone can be stale. */
async function serverAlive(origin: string): Promise<boolean> {
  try {
    await fetch(origin, { signal: AbortSignal.timeout(1_000) });
    return true;
  } catch {
    return false;
  }
}

function killGroup(child: Bun.Subprocess, signal: NodeJS.Signals): void {
  // detached gives the server its own process group, so this takes down its children too.
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // already gone
    }
  }
}

/**
 * Makes sure a local T3 Code server is up before connecting: if the runtime file's origin
 * answers, the existing server is used as-is; otherwise `t3 serve` is spawned and waited
 * for. Returns a handle that stops the server on quit — but only when t3tui started it.
 * An explicit T3TUI_SERVER or T3TUI_TOKEN never spawns.
 */
export async function ensureLocalServer(): Promise<SpawnedServer | null> {
  if (process.env.T3TUI_SERVER || process.env.T3TUI_TOKEN) return null;
  const existing = await localOrigin();
  if (existing && (await serverAlive(existing))) return null;

  let child: Bun.Subprocess;
  try {
    // Output goes to a log file: before the UI starts it is useful, after it would corrupt the screen.
    const logPath = join(configDir(), "server.log");
    mkdirSync(dirname(logPath), { recursive: true });
    const log = openSync(logPath, "a");
    child = Bun.spawn([...t3Command(), "serve"], {
      detached: true,
      stdio: ["ignore", log, log],
      // Spread explicitly: Bun.spawn can read the process's original environ, missing
      // variables set at runtime (tests, wrappers that set T3CODE_HOME).
      env: { ...process.env },
    });
  } catch {
    return null; // no `t3` binary: fall through to the usual "no server" reconnecting state
  }

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    killGroup(child, "SIGTERM");
    const exited = await Promise.race([child.exited, Bun.sleep(5_000).then(() => null)]);
    if (exited === null) {
      killGroup(child, "SIGKILL");
      await child.exited.catch(() => {});
    }
  };
  // Backstop for exits that bypass the UI's destroy handler (list, tmux, crashes).
  process.on("exit", () => {
    if (!stopped) killGroup(child, "SIGKILL");
  });

  const deadline = Date.now() + 30_000;
  let origin: string | null = null;
  while (Date.now() < deadline) {
    origin = await localOrigin();
    if (origin && (await serverAlive(origin))) return { origin, stop };
    if (child.exitCode !== null) break; // the server died on startup
    await Bun.sleep(200);
  }
  await stop();
  return null;
}
