import type { FilesystemBrowseResult } from "@t3tools/contracts";
import { filterFilesystemBrowseEntries, getFilesystemBrowsePath, getFilesystemBrowseTabCompletion } from "@t3tools/client-runtime/state/filesystem";
import { appendBrowsePathSegment, hasTrailingPathSeparator } from "@t3tools/client-runtime/state/projects";

import type { PickerItem } from "./palette.ts";
import { tildify } from "./paths.ts";

/** Where a typed path points: the folder it lists and the leaf segment filtering that listing. */
export interface PathBrowseInfo {
  readonly isPath: boolean;
  readonly directoryPath: string;
  readonly filterQuery: string;
  readonly parentPath: string | null;
  readonly canBrowseUp: boolean;
}

/** The web's browse-mode reading of a query: only path-looking queries (/, ~/, ./, ../) browse. */
export function pathBrowseInfo(query: string, platform = ""): PathBrowseInfo {
  const info = getFilesystemBrowsePath(query, platform);
  return {
    isPath: info.isBrowsing,
    directoryPath: info.directoryPath,
    filterQuery: info.filterQuery,
    parentPath: info.parentPath,
    canBrowseUp: info.canBrowseUp,
  };
}

/** The path Enter submits for a query: an exact folder match, the listed folder, or the typed text. */
export function resolvedBrowsePath(query: string, browse: FilesystemBrowseResult | null, exactFullPath: string | null): string {
  const trimmed = query.trim();
  return hasTrailingPathSeparator(trimmed) ? (browse?.parentPath ?? trimmed) : (exactFullPath ?? trimmed);
}

/** Shell-style Tab for a path query: one match enters it, several extend to their common prefix. */
export function pathTabCompletion(query: string, browse: FilesystemBrowseResult, platform = ""): string | null {
  const info = pathBrowseInfo(query, platform);
  if (!info.isPath) return null;
  const { visibleEntries } = filterFilesystemBrowseEntries(browse.entries, info.filterQuery);
  const completion = getFilesystemBrowseTabCompletion(visibleEntries, info.filterQuery);
  if (!completion) return null;
  return completion.isComplete ? appendBrowsePathSegment(query, completion.name) : `${info.directoryPath}${completion.name}`;
}

/**
 * A path picker's rows, as the web palette's browse mode lists them: the submit row first (so
 * Enter uses the typed path), then ".." and the folders under the typed path, which descend
 * into themselves and keep the picker open.
 */
export function pathPickerGroups(input: {
  readonly query: string;
  readonly platform?: string;
  readonly browse: FilesystemBrowseResult | null;
  /** What the submit row says, e.g. "Open or create ~/x". */
  readonly submitTitle: (resolved: string) => string;
  readonly onUsePath: (path: string) => void;
  /** Sets the query to a folder (with its trailing separator), descending into it. */
  readonly onBrowseTo: (path: string) => void;
}): { readonly label: string; readonly items: readonly PickerItem[] }[] {
  const info = pathBrowseInfo(input.query, input.platform ?? "");
  if (!info.isPath) return [];
  const { visibleEntries, exactEntry } = filterFilesystemBrowseEntries(input.browse?.entries ?? [], info.filterQuery);
  const resolved = resolvedBrowsePath(input.query, input.browse, exactEntry?.fullPath ?? null);
  const pathItems: PickerItem[] = [{ id: "path:use", title: input.submitTitle(resolved), hint: "enter", run: () => input.onUsePath(resolved) }];
  const folderItems: PickerItem[] = [];
  const parent = info.parentPath;
  if (info.canBrowseUp && parent !== null) {
    folderItems.push({ id: "path:up", title: "..", hint: tildify(parent), keepOpen: true, run: () => input.onBrowseTo(parent) });
  }
  for (const entry of visibleEntries) {
    folderItems.push({
      id: `path:${entry.fullPath}`,
      title: `${entry.name}/`,
      hint: tildify(entry.fullPath),
      keepOpen: true,
      run: () => input.onBrowseTo(appendBrowsePathSegment(input.query, entry.name)),
    });
  }
  const groups: { label: string; items: PickerItem[] }[] = [{ label: "Path", items: pathItems }];
  if (folderItems.length > 0) groups.push({ label: "Folders", items: folderItems });
  return groups;
}
