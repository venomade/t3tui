import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureLocalServer } from "../src/client/spawnServer.ts";

// A fake `t3` binary: ignores its args, serves one HTTP 200 and writes the runtime file
// the real server writes, so ensureLocalServer's probe sees it come up.
const fakeServerTs = `
  const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
  const fs = await import("node:fs");
  const dir = process.env.T3CODE_HOME + "/userdata";
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dir + "/server-runtime.json", JSON.stringify({ origin: "http://127.0.0.1:" + server.port, port: server.port }));
  setInterval(() => {}, 60_000);
`;

const saved: Record<string, string | undefined> = {};
const setEnv = (key: string, value: string | undefined) => {
  if (!(key in saved)) saved[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};

let scratch: string | null = null;
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    delete saved[key];
  }
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = null;
});

function setup(t3Bin?: string) {
  scratch = mkdtempSync(join(tmpdir(), "t3tui-spawn-"));
  setEnv("T3CODE_HOME", join(scratch, "t3home"));
  setEnv("XDG_CONFIG_HOME", join(scratch, "xdg"));
  setEnv("T3TUI_SERVER", undefined);
  setEnv("T3TUI_TOKEN", undefined);
  setEnv("T3TUI_T3_BIN", t3Bin);
  return scratch;
}

function fakeT3(dir: string): string {
  writeFileSync(join(dir, "fake-server.ts"), fakeServerTs);
  const bin = join(dir, "t3");
  writeFileSync(bin, `#!/bin/sh\nexec ${process.execPath} ${join(dir, "fake-server.ts")} "$@"\n`);
  chmodSync(bin, 0o755);
  return bin;
}

describe("ensureLocalServer", () => {
  test("spawns `t3 serve` when nothing answers, and stops it", async () => {
    const dir = setup();
    const server = await ensureLocalServerWith(fakeT3(dir));
    expect(server).not.toBeNull();
    // The spawned server answers at its origin.
    const response = await fetch(server!.origin);
    expect(response.status).toBe(200);
    await server!.stop();
    // After stop, the origin is dead again.
    await expect(fetch(server!.origin, { signal: AbortSignal.timeout(1_000) })).rejects.toThrow();
  });

  test("connects to the existing server when one answers, without spawning", async () => {
    const dir = setup();
    // A server that is already up, with its runtime file in place.
    const running = Bun.serve({ port: 0, fetch: () => new Response("ok") });
    const { mkdirSync, writeFileSync: write } = await import("node:fs");
    mkdirSync(join(process.env.T3CODE_HOME!, "userdata"), { recursive: true });
    write(join(process.env.T3CODE_HOME!, "userdata", "server-runtime.json"), JSON.stringify({ origin: `http://127.0.0.1:${running.port}`, port: running.port }));
    // A t3 binary that would fail the test if spawned: it exits immediately.
    const bin = join(dir, "t3");
    writeFileSync(bin, "#!/bin/sh\nexit 1\n");
    const server = await ensureLocalServerWith(bin);
    expect(server).toBeNull();
    running.stop(true);
  });

  test("never spawns for an explicit T3TUI_SERVER or T3TUI_TOKEN", async () => {
    setup();
    setEnv("T3TUI_SERVER", "http://127.0.0.1:1");
    expect(await ensureLocalServer()).toBeNull();
    setEnv("T3TUI_SERVER", undefined);
    setEnv("T3TUI_TOKEN", "token");
    expect(await ensureLocalServer()).toBeNull();
  });
});

// ensureLocalServer reads T3TUI_T3_BIN at call time via t3Command, so setting it after
// setup() is enough; this wrapper just keeps the tests readable.
async function ensureLocalServerWith(t3Bin: string) {
  setEnv("T3TUI_T3_BIN", t3Bin);
  return ensureLocalServer();
}
