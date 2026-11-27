# Developing t3tui

## Running from source

`t3tui` runs the bundle in `dist/`, which uses over 100 MB less memory than the sources. After pulling changes, run `bun run build` (or `bun install`) to rebuild it; `bun run dev` runs the sources directly.

Set `T3TUI_DEBUG=/path/to/log` to log thread subscriptions and snapshots.

The [Test workflow](../.github/workflows/test.yml) typechecks, lints and runs the suite on every push (run it by hand to check without pushing); locally that's `bun run typecheck && bun run lint && bun test`.

## How it connects

- It finds the local server from `~/.t3/userdata/server-runtime.json` (override with `T3TUI_SERVER`). If that file is missing and `detectT3CodeSetup()` (in `src/client/auth.ts`) finds nothing of a T3 Code setup either — no t3 home files, no `t3` CLI, no `T3TUI_SERVER`/`T3TUI_TOKEN` — the error and the dashboard notice (`src/ui/SetupNotice.tsx`) say t3tui is a companion app and T3 Code must be set up first, linking to github.com/pingdotgg/t3code.
- On first run it mints its own bearer session with `t3 auth session issue --label t3tui`, scoped to `orchestration:read`, `orchestration:operate` (attachments and automations ride on it), `filesystem:read` (diffs), `source-control:write` (git actions), `terminal:read` and `terminal:operate` (terminals, stopping servers), `diagnostics:read` (usage totals) and `providers:manage` (reset credits), and stores it in `~/.config/t3tui/credentials.json` (mode 600). A stored credential missing any of these scopes is replaced with a new one. Revoke it any time with `t3 auth session revoke`. For a remote server, pass a token in `T3TUI_TOKEN`.
- It speaks T3 Code's own WebSocket RPC protocol, typed by upstream's `@t3tools/contracts`, and applies thread updates with upstream's own reducers. Both come from `vendor/t3code`, a submodule pinned to the server version this was built against (commit `bc0f04da94`, v0.1.13).

## Following the web app

t3tui aims to behave like T3 Code's web app: the same sidebar sections and status words, timeline, thread menu, palette scoring, alert rules, setting names and defaults (except the two alert settings), attachment limits, and editor fallback order. Where it can, it uses the web app's own code from `vendor/t3code` rather than reimplementing it. When a behaviour differs, that's either a gap (listed under "Not yet supported" in the README) or a terminal constraint, such as links showing as raw markdown in the message box instead of chips.

Some gaps come from the pinned server rather than t3tui: it doesn't publish update-available or shutting-down events, historical checkpoint diffs have no unchanged context, and the open-in-editor RPC has no line argument.

## Updating for a newer T3 Code

The protocol packages are private and change without notice, so t3tui tracks a pinned upstream tag:

```sh
cd vendor/t3code && git fetch --depth 1 origin tag <tag> && git checkout <tag> && cd -
bun install && bun run typecheck && bun test
```

Type errors after a bump point at the protocol changes to adapt to.

Two patches ride along with a bump: upstream's `patches/effect@*.patch` is applied to the installed `effect` package through `patchedDependencies` in `package.json` (copy the current patch file into `patches/` when the effect version changes), and `tscPatches` in `scripts/link-vendor.ts` fixes the spots where classic `tsc` can't infer what upstream's Effect language service can — the vendored packages are copied into `node_modules/@t3tools` for this, so `vendor/` itself stays pristine.

## Releasing

Releases are standalone binaries built with `bun build --compile`, so users don't need Bun or a checkout. To cut one, bump `version` in `package.json`, commit, and push a matching tag:

```sh
git tag v0.1.0 && git push origin v0.1.0
```

The [Release workflow](../.github/workflows/release.yml) compiles linux-x64, linux-arm64, linux-x64-musl, linux-arm64-musl, darwin-x64, darwin-arm64 and windows-x64 on one machine, smoke-runs each on its own OS (the linux glibc targets on ubuntu runners, the musl targets inside Alpine containers, the dashboard draw check on macOS; on Windows it only runs `t3tui version`), and publishes them gzipped with a `SHA256SUMS` file to the releases of github.com/venomade/t3tui, which `t3tui upgrade` checks: it pulls `/releases/latest` (never a prerelease), verifies the asset against `SHA256SUMS`, and picks the `-musl` asset on musl systems. Run the workflow by hand to build and check the binaries without releasing.

To build a binary locally, run `bun run compile` (this machine) or name targets, e.g. `bun run compile darwin-arm64`. Other platforms' targets need their OpenTUI packages: `bun install --os='*' --cpu='*'`. Binaries go in `release/`. Linux targets also build as `-musl` variants (`linux-x64-musl`, `linux-arm64-musl`), which run on musl systems (Alpine, containers) — note they still need `libstdc++` there, and the glibc build only runs on glibc hosts. The release workflow builds on ubuntu with the official bun, whose embedded runtime has the standard `/lib64/ld-linux-x86-64.so.2` interpreter; building with a nix bun instead embeds the nix-store loader, so such binaries only run on the same nix machine — use the official bun (or patchelf the interpreter) for portable local builds.
