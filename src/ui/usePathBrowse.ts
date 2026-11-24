import { useEffect, useMemo, useState } from "react";
import type { FilesystemBrowseResult } from "@t3tools/contracts";

import type { T3Session } from "../client/session.ts";
import { pathBrowseInfo, pathPickerGroups, pathTabCompletion } from "../model/browse.ts";
import type { PaletteGroup, Picker, PickerItem } from "../model/palette.ts";
import { tildify } from "../model/paths.ts";

/**
 * The folder listing behind a path picker (a picker with `pathMode`), as the web palette's browse
 * mode: the query is a path, the folders under it autocomplete it, and the submit row hands the
 * resolved path to the picker's `onPath`. The web waits 120ms before listing, and ignores results
 * from paths already replaced.
 */
export function usePathBrowse(deps: {
  readonly session: T3Session;
  readonly picker: Picker | null;
  readonly query: string;
  readonly setQuery: (query: string) => void;
}) {
  const pathMode = deps.picker?.pathMode ?? null;
  const info = useMemo(() => (pathMode ? pathBrowseInfo(deps.query, pathMode.platform ?? "") : null), [pathMode, deps.query]);
  const directoryPath = info?.isPath ? info.directoryPath : null;
  const cwd = pathMode?.cwd ?? null;
  const [browse, setBrowse] = useState<FilesystemBrowseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!pathMode || directoryPath === null) {
      setBrowse(null);
      setError(null);
      setPending(false);
      return;
    }
    let cancelled = false;
    setPending(true);
    const timer = setTimeout(() => {
      deps.session.browseFilesystem(directoryPath, cwd ?? undefined).then(
        (value) => {
          if (!cancelled) {
            setBrowse(value);
            setError(null);
            setPending(false);
          }
        },
        (browseError) => {
          if (!cancelled) {
            setBrowse(null);
            setError(browseError instanceof Error ? browseError.message : String(browseError));
            setPending(false);
          }
        },
      );
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [deps.session, pathMode, directoryPath, cwd]);

  const groups = useMemo(() => {
    if (!pathMode) return [];
    return pathPickerGroups({
      query: deps.query,
      ...(pathMode.platform === undefined ? {} : { platform: pathMode.platform }),
      browse,
      submitTitle: (resolved) => `Open or create ${tildify(resolved)}`,
      onUsePath: (path) => pathMode.onPath(path),
      onBrowseTo: (path) => deps.setQuery(path),
    });
  }, [pathMode, deps.query, browse, deps.setQuery]);

  const view = useMemo<PaletteGroup[]>(
    () =>
      groups.map((group) => ({
        label: group.label,
        entries: group.items.map((item): PaletteGroup["entries"][number] => ({ kind: "command", command: { id: item.id, title: item.title, ...(item.hint ? { shortcut: item.hint } : {}) } })),
      })),
    [groups],
  );
  const items = useMemo<PickerItem[]>(() => groups.flatMap((group) => group.items), [groups]);
  const status = error ?? (pending ? "Listing folders…" : info && !info.isPath ? "Type a path (e.g. ~/projects/my-app)" : null);
  const tabCompletion = () => (pathMode && browse && info?.isPath ? pathTabCompletion(deps.query, browse, pathMode.platform ?? "") : null);

  return { view, items, status, tabCompletion };
}
