import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testRender } from "@opentui/react/test-utils";
import { createMockKeys, type KeyInput } from "@opentui/core/testing";
import { RunId, type OrchestrationV2ShellSnapshot, type OrchestrationV2ThreadProjection, type ThreadId } from "@t3tools/contracts";

import type { ConnectionStatus, T3Session } from "../../src/client/session.ts";
import { DEFAULT_CONFIG, type T3tuiConfig } from "../../src/config.ts";
import type { Layout } from "../../src/layout.ts";
import { App } from "../../src/ui/App.tsx";
import type { Clipboard, ClipboardImage } from "../../src/ui/clipboard.ts";
import { v2Projection, v2ShellSnapshot, v2ThreadId } from "../../vendor/t3code/packages/client-runtime/src/state/orchestrationV2TestFixtures.ts";

export { v2Projection, v2ShellSnapshot, v2ThreadId };

// Settings and layout saves go to a scratch folder, never the real config.
process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "t3tui-test-"));

// Updates from the app's own timers land outside act(); the warnings say nothing useful here.
const consoleError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("not wrapped in act")) return;
  consoleError(...args);
};

export interface Call {
  readonly method: string;
  readonly args: readonly unknown[];
}

/**
 * A session that serves fixed state and records every other call. Watchers get one live
 * value straight away; anything not listed resolves to undefined, or rejects with its
 * `failures` message. A result given as a function answers from the call's arguments.
 */
export function fakeSession(
  state: {
    readonly snapshot?: OrchestrationV2ShellSnapshot;
    readonly projection?: OrchestrationV2ThreadProjection;
    readonly status?: ConnectionStatus;
    /** Git status for every folder; loading by default. */
    readonly vcs?: unknown;
    readonly results?: Record<string, unknown | ((...args: never[]) => unknown)>;
    /** The thread's terminals on the server, and what attaching to one streams. */
    readonly terminals?: readonly unknown[];
    readonly terminalEvents?: readonly unknown[];
    readonly failures?: Record<string, string>;
    /** The server's config; loading by default. */
    readonly serverConfig?: unknown;
  } = {},
) {
  const calls: Call[] = [];
  const threadListeners = new Set<(value: unknown) => void>();
  // The default thread has a finished run, as upstream's menu tests assume: "Mark unread"
  // only shows once the latest run completed.
  const snapshot =
    state.snapshot ??
    ({ ...v2ShellSnapshot, threads: v2ShellSnapshot.threads.map((thread) => ({ ...thread, latestRunId: RunId.make("run-v2") })) } as OrchestrationV2ShellSnapshot);
  const projection = state.projection ?? v2Projection;
  const live = <T,>(value: T) => (listener: (value: T) => void) => {
    listener(value);
    return () => {};
  };
  const known: Record<string, unknown> = {
    getShell: () => ({ status: state.status ?? { type: "live" }, snapshot, serverUrl: "ws://test" }),
    onShell: () => () => {},
    watchThread: (_id: ThreadId, listener: (value: unknown) => void) => {
      threadListeners.add(listener);
      listener({ status: "live", projection, history: { cursor: null, hasMore: false, loading: false } });
      return () => threadListeners.delete(listener);
    },
    watchServerConfig: live(state.serverConfig ? { status: "live", config: state.serverConfig } : { status: "loading", config: null }),
    watchServers: live({ status: "live", items: [] }),
    watchAutomations: live({ status: "live", items: [] }),
    watchTerminals: live({ status: "live", items: state.terminals ?? [] }),
    attachTerminal: (input: unknown, onEvent: (event: unknown) => void) => {
      calls.push({ method: "attachTerminal", args: [input] });
      for (const event of state.terminalEvents ?? []) onEvent(event);
      return () => calls.push({ method: "detachTerminal", args: [] });
    },
    watchVcs: (_cwd: string, listener: (value: unknown) => void) => live(state.vcs ?? { status: "loading", local: null, remote: null })(listener),
  };
  const session = new Proxy(known, {
    get(target, name) {
      if (typeof name !== "string") return undefined;
      if (name in target) return target[name];
      if (name === "then") return undefined;
      return (...args: unknown[]) => {
        calls.push({ method: name, args });
        if (name.startsWith("watch") || name.startsWith("on")) return () => {};
        const failure = state.failures?.[name];
        const result = state.results?.[name];
        if (failure) return Promise.reject(new Error(failure));
        return typeof result === "function" ? Promise.resolve().then(() => result(...args)) : Promise.resolve(result);
      };
    },
  }) as unknown as T3Session;
  /** Sends watchers of the thread a new projection, as the server does when it changes. */
  const updateThread = (next: OrchestrationV2ThreadProjection) => {
    for (const listener of threadListeners) listener({ status: "live", projection: next, history: { cursor: null, hasMore: false, loading: false } });
  };
  return { session, calls, updateThread };
}

/** Renders the whole app against a fake session, with helpers to drive it by key and mouse. */
export async function renderApp(
  options: {
    readonly session?: ReturnType<typeof fakeSession>;
    readonly config?: Partial<T3tuiConfig>;
    readonly layout?: Layout;
    readonly width?: number;
    readonly height?: number;
    /** What the clipboard holds; copies to it are recorded as "copy" calls. */
    readonly clipboard?: { readonly image?: ClipboardImage; readonly text?: string };
    /** True when the app spawned `t3 serve` itself, so quitting stops the server too. */
    readonly ownsServer?: boolean;
  } = {},
) {
  const fake = options.session ?? fakeSession();
  const config = { ...DEFAULT_CONFIG, ...options.config };
  const clipboard: Clipboard = {
    readImage: async () => options.clipboard?.image ?? "empty",
    readText: async () => options.clipboard?.text ?? null,
    copy: async (text) => {
      fake.calls.push({ method: "copy", args: [text] });
      return true;
    },
  };
  // exitOnCtrlC false as in bin.ts: the app owns ctrl+c (it asks before quitting), so the
  // renderer must not tear itself down on it.
  const rig = await testRender(<App session={fake.session} config={config} clipboard={clipboard} {...(options.ownsServer !== undefined ? { ownsServer: options.ownsServer } : {})} {...(options.layout ? { layout: options.layout } : {})} />, { width: options.width ?? 140, height: options.height ?? 40, exitOnCtrlC: false });
  // The app runs on timers and subscriptions, as it does live: tests wait for frames rather than wrap each update in act().
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  const keys = createMockKeys(rig.renderer);
  /**
   * Lets effects, timers and React updates land: waits `ms`, then draws frames until two in a
   * row match. A loaded machine (the whole suite at once) can take far longer than `ms`.
   */
  const settle = async (ms = 20) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    // Once the app quits it destroys the renderer; rendering and captures fail after that.
    try {
      await rig.renderOnce();
      let last = rig.captureCharFrame();
      // Wait for two identical frames, but with a time budget rather than a try count:
      // on a small CI runner a frame can take far longer than 15ms, and a fixed count
      // can give up while an update is still in flight.
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        await rig.renderOnce();
        const next = rig.captureCharFrame();
        if (next === last) return;
        last = next;
      }
    } catch {
      return;
    }
  };
  await settle(300);
  const named: Record<string, KeyInput> = { escape: "ESCAPE", return: "RETURN", tab: "TAB", up: "ARROW_UP", down: "ARROW_DOWN", left: "ARROW_LEFT", right: "ARROW_RIGHT", backspace: "BACKSPACE" };
  /** Presses a key by its OpenTUI name: "j", "Y", "escape", "return". */
  const press = async (key: string, modifiers?: Parameters<typeof keys.pressKey>[1]) => {
    keys.pressKey(named[key] ?? key, modifiers);
    // A lone esc waits 20ms in case it starts a longer sequence.
    await settle(key === "escape" ? 60 : 20);
  };
  const type = async (text: string) => {
    await keys.typeText(text);
    await settle();
  };
  /** A bracketed paste, as a terminal sends one. */
  const paste = async (text: string) => {
    await keys.pasteBracketedText(text);
    await settle();
  };
  const click = async (x: number, y: number, button: 0 | 2 = 0) => {
    await rig.mockMouse.click(x, y, button);
    await settle();
  };
  const frame = () => rig.captureCharFrame();
  /** The line the hint bar is on: the last one on screen. */
  const hints = () => frame().trimEnd().split("\n").at(-1)?.trim() ?? "";
  /** Where some text first appears on screen, for clicking it. */
  const find = (text: string) => {
    const lines = frame().split("\n");
    for (let y = 0; y < lines.length; y++) {
      const x = lines[y]!.indexOf(text);
      if (x >= 0) return { x, y };
    }
    throw new Error(`"${text}" is not on screen:\n${frame()}`);
  };
  const calls = (method: string) => fake.calls.filter((call) => call.method === method);
  const destroy = () => {
    try {
      rig.renderer.destroy();
    } catch {
      // Already destroyed by the app quitting.
    }
  };
  return { ...rig, session: fake.session, press, type, paste, click, settle, frame, hints, find, calls, destroy };
}
