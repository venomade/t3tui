import { expect, test } from "bun:test";
import type { FilesystemBrowseResult } from "@t3tools/contracts";

import { pathBrowseInfo, pathPickerGroups, pathTabCompletion, resolvedBrowsePath } from "../src/model/browse.ts";

const browse: FilesystemBrowseResult = {
  parentPath: "/home/u/projects/",
  entries: [
    { name: "api", fullPath: "/home/u/projects/api" },
    { name: "app", fullPath: "/home/u/projects/app" },
    { name: "apple", fullPath: "/home/u/projects/apple" },
  ],
};

test("reads a typed path as the folder it lists and the leaf filtering it", () => {
  expect(pathBrowseInfo("~/projects/ap", "linux")).toEqual({ isPath: true, directoryPath: "~/projects/", filterQuery: "ap", parentPath: "~/", canBrowseUp: true });
  expect(pathBrowseInfo("/ho", "linux")).toEqual({ isPath: true, directoryPath: "/", filterQuery: "ho", parentPath: null, canBrowseUp: false });
  expect(pathBrowseInfo("~/", "linux")).toMatchObject({ isPath: true, directoryPath: "~/", filterQuery: "" });
  expect(pathBrowseInfo("hello", "linux").isPath).toBe(false);
  // Windows paths only count on a Windows server.
  expect(pathBrowseInfo("C:\\x", "linux").isPath).toBe(false);
  expect(pathBrowseInfo("C:\\x", "windows").isPath).toBe(true);
});

test("resolves the submitted path: exact match, listed folder, or the typed text", () => {
  expect(resolvedBrowsePath("~/projects/api", browse, "/home/u/projects/api")).toBe("/home/u/projects/api");
  expect(resolvedBrowsePath("~/projects/", browse, null)).toBe("/home/u/projects/");
  expect(resolvedBrowsePath("~/projects/new-thing", browse, null)).toBe("~/projects/new-thing");
});

test("lists the submit row first, then .. and the matching folders, which stay open", () => {
  const groups = pathPickerGroups({ query: "~/projects/ap", browse, submitTitle: (resolved) => `Open or create ${resolved}`, onUsePath: () => {}, onBrowseTo: () => {} });
  expect(groups.map((group) => group.label)).toEqual(["Path", "Folders"]);
  const [submit, ...folders] = groups.flatMap((group) => group.items);
  expect(submit).toMatchObject({ id: "path:use", title: "Open or create ~/projects/ap", hint: "enter" });
  expect(submit!.keepOpen).toBeUndefined();
  expect(folders[0]).toMatchObject({ id: "path:up", title: "..", keepOpen: true });
  expect(folders.slice(1).map((item) => item.title)).toEqual(["api/", "app/", "apple/"]);
  expect(folders.every((item) => item.keepOpen === true)).toBe(true);
  // A folder row descends into itself.
  let browsed = "";
  pathPickerGroups({ query: "~/projects/", browse, submitTitle: () => "", onUsePath: () => {}, onBrowseTo: (path) => (browsed = path) })[1]!.items[1]!.run();
  expect(browsed).toBe("~/projects/api/");
  // Not a path: no rows.
  expect(pathPickerGroups({ query: "hello", browse, submitTitle: () => "", onUsePath: () => {}, onBrowseTo: () => {} })).toEqual([]);
});

test("submitting picks the exact folder when the leaf matches one", () => {
  let used = "";
  const groups = pathPickerGroups({ query: "~/projects/api", browse, submitTitle: (resolved) => resolved, onUsePath: (path) => (used = path), onBrowseTo: () => {} });
  groups[0]!.items[0]!.run();
  expect(used).toBe("/home/u/projects/api");
});

test("tab completes one match into its folder and several to their common prefix", () => {
  expect(pathTabCompletion("~/projects/api", browse, "linux")).toBe("~/projects/api/");
  expect(pathTabCompletion("~/projects/a", browse, "linux")).toBe("~/projects/ap");
  // The common prefix of api/app/apple under "ap" is "ap" itself: nothing to add.
  expect(pathTabCompletion("~/projects/ap", browse, "linux")).toBeNull();
  expect(pathTabCompletion("hello", browse, "linux")).toBeNull();
});
