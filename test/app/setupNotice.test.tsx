import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fakeSession, renderApp, v2ShellSnapshot } from "./harness.tsx";
import { restoreEnv, saveEnv } from "../env.ts";

let app: Awaited<ReturnType<typeof renderApp>> | null = null;
const open = async (...args: Parameters<typeof renderApp>) => (app = await renderApp(...args));
afterEach(() => {
  app?.destroy();
  app = null;
});

const reconnecting = () => ({ type: "reconnecting", message: "No running T3 Code server found", retryAt: Date.now() + 5_000 }) as const;
// A fresh machine's shell: no projects, no threads.
const freshSnapshot = { ...v2ShellSnapshot, projects: [], threads: [], archivedThreads: [] };

describe("no T3 Code setup detected", () => {
  const saved = saveEnv();

  afterEach(() => restoreEnv(saved));

  /** Pretends the machine has nothing of T3 Code: an empty t3 home and no t3 binary. */
  const pretendFreshMachine = () => {
    process.env.T3CODE_HOME = mkdtempSync(join(tmpdir(), "t3tui-nosetup-"));
    process.env.T3TUI_T3_BIN = "/nonexistent/t3";
    delete process.env.T3TUI_SERVER;
    delete process.env.T3TUI_TOKEN;
  };

  test("the conversation says t3tui is a companion app and T3 Code comes first, ACPs included", async () => {
    pretendFreshMachine();
    const app = await open({ session: fakeSession({ status: reconnecting(), snapshot: freshSnapshot }) });
    expect(app.frame()).toContain("t3tui is a companion app to T3 Code");
    expect(app.frame()).toContain("No T3 Code setup was detected on this machine");
    expect(app.frame()).toContain("Attach agent ACPs (providers) in the official T3 Code application");
  });

  test("with a T3 Code setup present, the notice stays away and the retry note shows", async () => {
    pretendFreshMachine();
    mkdirSync(join(process.env.T3CODE_HOME!, "userdata"), { recursive: true });
    writeFileSync(join(process.env.T3CODE_HOME!, "userdata", "server-owner.sqlite"), "");
    const app = await open({ session: fakeSession({ status: reconnecting(), snapshot: freshSnapshot }) });
    expect(app.frame()).not.toContain("companion app");
    expect(app.frame()).toContain("couldn't connect");
  });
});
