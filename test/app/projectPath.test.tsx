import { afterEach, describe, expect, test } from "bun:test";
import type { OrchestrationV2ShellSnapshot } from "@t3tools/contracts";

import { v2Project } from "../../vendor/t3code/packages/client-runtime/src/state/orchestrationV2TestFixtures.ts";
import { fakeSession, renderApp, v2ShellSnapshot } from "./harness.tsx";

let app: Awaited<ReturnType<typeof renderApp>> | null = null;
const open = async (...args: Parameters<typeof renderApp>) => (app = await renderApp(...args));
afterEach(() => {
  app?.destroy();
  app = null;
});

const serverConfig = { providers: [], settings: { projectSettingsOverrides: {} }, environment: { platform: { os: "linux" }, capabilities: {} } };

/** The home and /tmp listings the fake server answers browse calls with. */
const listings: Record<string, unknown> = {
  "~/": { parentPath: "/home/u/", entries: [{ name: "projects", fullPath: "/home/u/projects" }, { name: "workspace", fullPath: "/workspace" }] },
  "~/projects/": { parentPath: "/home/u/projects/", entries: [{ name: "api", fullPath: "/home/u/projects/api" }] },
  "~/workspace/": { parentPath: "/workspace/", entries: [{ name: "project", fullPath: "/workspace/project" }] },
  "~/workspace/project/": { parentPath: "/workspace/project/", entries: [] },
  "/tmp/": { parentPath: "/tmp/", entries: [] },
};

/** Opens the new-thread draft and then the project picker's "new project from a path" row. */
async function openProjectPathPicker(a: Awaited<ReturnType<typeof renderApp>>) {
  await a.press("c");
  // Draft keys (p, m, w) bind in nav mode, so leave the composer first.
  await a.press("escape");
  await a.press("p");
  expect(a.frame()).toContain("New project from a folder path");
  await a.press("down");
  await a.press("return");
  // The path picker starts at "~/" and lists the home folder after its debounce.
  await a.settle(400);
}

describe("new project from a path", () => {
  test("typing a path and enter creates the project and selects it in the draft", async () => {
    let updateShell: ((snapshot: OrchestrationV2ShellSnapshot) => void) | null = null;
    const fake = fakeSession({
      serverConfig,
      results: {
        browseFilesystem: (partialPath: string) => listings[partialPath],
        createProject: (input: { title: string; workspaceRoot: string }) => {
          const project = { ...v2Project, id: "p-new" as never, title: input.title, workspaceRoot: input.workspaceRoot };
          setTimeout(() => updateShell?.({ ...v2ShellSnapshot, projects: [v2Project, project] }), 0);
          return project;
        },
      },
    });
    updateShell = fake.updateShell;
    const app = await open({ session: fake });
    await openProjectPathPicker(app);
    expect(app.calls("browseFilesystem").map((call) => call.args[0])).toEqual(["~/"]);
    expect(app.frame()).toContain("Open or create");
    expect(app.frame()).toContain("projects/");
    // Type a path that doesn't exist yet, over the initial "~/".
    await app.press("backspace");
    await app.press("backspace");
    await app.type("/tmp/brand-new");
    await app.settle(400);
    expect(app.frame()).toContain("Open or create /tmp/brand-new");
    await app.press("return");
    await app.settle(400);
    expect(app.calls("createProject").map((call) => call.args[0])).toEqual([{ title: "brand-new", workspaceRoot: "/tmp/brand-new", createWorkspaceRootIfMissing: true }]);
    expect(app.hints()).toContain("Added project");
    // The draft now runs in the new project.
    expect(app.frame()).toMatch(/Project\s+brand-new/);
  });

  test("a path that is already a project just selects it", async () => {
    const fake = fakeSession({ serverConfig, results: { browseFilesystem: (partialPath: string) => listings[partialPath] } });
    const app = await open({ session: fake });
    await openProjectPathPicker(app);
    // Descend ~/ -> workspace -> project, the open thread's project folder.
    // Home rows: submit, projects/, workspace/ — so two downs land on workspace/.
    await app.press("down");
    await app.press("down");
    await app.press("return");
    await app.settle(400);
    // ~/workspace/ rows: submit, .., project/.
    await app.press("down");
    await app.press("down");
    await app.press("return");
    await app.settle(400);
    expect(app.frame()).toContain("Open or create /workspace/project");
    await app.press("return");
    await app.settle(200);
    expect(app.calls("createProject")).toHaveLength(0);
    expect(app.hints()).toContain("already a project");
  });

  test("tab completes the typed path like a shell", async () => {
    const fake = fakeSession({ serverConfig, results: { browseFilesystem: (partialPath: string) => listings[partialPath] } });
    const app = await open({ session: fake });
    await openProjectPathPicker(app);
    await app.press("backspace");
    await app.press("backspace");
    await app.type("~/pro");
    await app.settle(400);
    await app.press("tab");
    await app.settle(200);
    // One match: tab enters the folder.
    expect(app.frame()).toContain("~/projects/");
    expect(app.calls("browseFilesystem").map((call) => call.args[0])).toContain("~/projects/");
  });
});
