import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { detectT3CodeSetup, findT3Binary, NO_T3CODE_SETUP_MESSAGE, resolveLocalServer, t3Command } from "../src/client/auth.ts";
import { restoreEnv, saveEnv } from "./env.ts";

const appCopy = join(homedir(), ".t3", "bin", "t3");
const installerCopy = join(homedir(), ".local", "bin", "t3.cmd");

describe("t3Command", () => {
  const saved = { bin: process.env.T3TUI_T3_BIN, home: process.env.T3CODE_HOME };

  beforeEach(() => {
    delete process.env.T3TUI_T3_BIN;
    delete process.env.T3CODE_HOME;
  });

  afterEach(() => {
    delete process.env.T3TUI_T3_BIN;
    if (saved.bin !== undefined) process.env.T3TUI_T3_BIN = saved.bin;
    if (saved.home !== undefined) process.env.T3CODE_HOME = saved.home;
  });

  test("prefers the desktop app's copy, then the PATH", () => {
    expect(t3Command((path) => path === appCopy, () => "/usr/bin/t3")).toEqual([appCopy]);
    expect(t3Command((path) => path === "/usr/bin/t3", () => "/usr/bin/t3")).toEqual(["/usr/bin/t3"]);
  });

  test("runs where the Windows installer puts it, which needs cmd", () => {
    expect(t3Command((path) => path === installerCopy, () => null)).toEqual(["cmd.exe", "/c", "call", installerCopy]);
  });

  test("runs a .cmd on the PATH through cmd too", () => {
    const shim = "C:\\npm\\t3.CMD";
    expect(t3Command((path) => path === shim, () => shim)).toEqual(["cmd.exe", "/c", "call", shim]);
  });

  test("falls back to the bare name so the error names it", () => {
    expect(t3Command(() => false, () => null)).toEqual(["t3"]);
  });

  test("T3TUI_T3_BIN wins", () => {
    process.env.T3TUI_T3_BIN = "/opt/t3";
    expect(t3Command(() => true, () => "/usr/bin/t3")).toEqual(["/opt/t3"]);
  });
});

describe("detectT3CodeSetup", () => {
  const saved = saveEnv();

  beforeEach(() => {
    delete process.env.T3TUI_T3_BIN;
    delete process.env.T3CODE_HOME;
    delete process.env.T3TUI_SERVER;
    delete process.env.T3TUI_TOKEN;
    process.env.T3CODE_HOME = "/nonexistent-t3-home";
  });

  afterEach(() => restoreEnv(saved));

  test("nothing detected: no env target, no t3 home files, no t3 binary", () => {
    expect(detectT3CodeSetup(() => false, () => null)).toEqual({ detected: false });
  });

  test("the t3 home's first-run files count as a setup", () => {
    expect(detectT3CodeSetup((path) => path.endsWith("userdata/server-owner.sqlite"), () => null)).toEqual({ detected: true });
    expect(detectT3CodeSetup((path) => path.endsWith("userdata/server-runtime.json"), () => null)).toEqual({ detected: true });
  });

  test("an installed t3 binary counts as a setup", () => {
    expect(detectT3CodeSetup((path) => path === "/usr/bin/t3", () => "/usr/bin/t3")).toEqual({ detected: true });
    expect(detectT3CodeSetup(() => false, () => null) && findT3Binary(() => false, () => null)).toBeNull();
  });

  test("an explicit server or token counts, whatever the machine has", () => {
    process.env.T3TUI_SERVER = "http://example:3773";
    expect(detectT3CodeSetup(() => false, () => null)).toEqual({ detected: true });
    delete process.env.T3TUI_SERVER;
    process.env.T3TUI_TOKEN = "secret";
    expect(detectT3CodeSetup(() => false, () => null)).toEqual({ detected: true });
  });
});

describe("resolveLocalServer without a setup", () => {
  const saved = saveEnv();

  beforeEach(() => {
    // An empty t3 home and a T3TUI_T3_BIN that does not exist: nothing of a T3 Code setup.
    process.env.T3CODE_HOME = mkdtempSync(join(tmpdir(), "t3tui-auth-test-"));
    process.env.T3TUI_T3_BIN = "/nonexistent/t3";
    delete process.env.T3TUI_SERVER;
    delete process.env.T3TUI_TOKEN;
  });

  afterEach(() => restoreEnv(saved));

  test("says t3tui is a companion app, with the T3 Code URL, and T3 Code comes first", async () => {
    await expect(resolveLocalServer()).rejects.toThrow(/companion app to T3 Code/);
    await expect(resolveLocalServer()).rejects.toThrow("https://github.com/pingdotgg/t3code");
    await expect(resolveLocalServer()).rejects.toThrow(NO_T3CODE_SETUP_MESSAGE);
  });

  test("with a setup present but no server running, asks for the server instead", async () => {
    mkdirSync(join(process.env.T3CODE_HOME!, "userdata"), { recursive: true });
    writeFileSync(join(process.env.T3CODE_HOME!, "userdata", "server-owner.sqlite"), "");
    await expect(resolveLocalServer()).rejects.toThrow(/No running T3 Code server found/);
  });
});
