# t3tui

**A TUI for a GUI for TUIs.**

Claude Code and Codex run in a terminal. [T3 Code](https://github.com/pingdotgg/t3code) gives them a proper app, with your threads, worktrees, diffs and approvals in one window, which is a lot nicer than keeping track of a dozen terminal tabs. t3tui takes that app and puts it back in a terminal.

It works anywhere you can get a shell, so you can check on a run over SSH from a laptop or your phone, or from a server you were already logged into. `t3tui tmux --watch` mirrors each active thread into its own tmux window, which you can detach from and come back to later. Everything is on the keyboard (`j`/`k` between threads, `y` to approve, `D` for the diff, `ctrl+k` for the rest), and `t3tui list --json` gives scripts something to read. Since it talks to the same server as the app, you can start a run in one and carry on in the other without anything needing to sync.

t3tui doesn't have to do much. T3 Code's server runs the agents and keeps track of sessions, worktrees, checkpoints, approvals, terminals and pull requests. t3tui connects to the server you already have running, speaks its WebSocket protocol, and applies updates with upstream's own types and reducers, so mostly it draws what T3 Code already knows and sends back what you type. That's why it was quick to build, and why it tends to stay in step with the app. Credit for the parts that work goes to T3 Code; anything that looks wrong is probably t3tui's fault.

Built with Bun and [OpenTUI](https://github.com/anomalyco/opentui) (React). t3tui is an unofficial project, not made by or affiliated with the T3 Code team.

## Install

t3tui is a companion to [T3 Code](https://github.com/pingdotgg/t3code), not a standalone app: install and set up T3 Code first — from [github.com/pingdotgg/t3code](https://github.com/pingdotgg/t3code) — and make sure its server is running on the same machine (or have a token for a remote one; see [How it connects](#how-it-connects)). If t3tui finds no T3 Code setup when it starts, it says so and points you there. Attach your agent ACPs (providers) in the T3 Code app.

Download a ready-made binary from the [latest release](https://github.com/venomade/t3tui/releases/latest) — one gzipped file per system, with a `SHA256SUMS` file to check them against:

| Asset | System |
| --- | --- |
| `t3tui-linux-x64.gz` | Linux x86_64, glibc (Ubuntu, Debian, Arch, Fedora, …) |
| `t3tui-linux-x64-musl.gz` | Linux x86_64, musl (Alpine, containers; needs `libstdc++` there) |
| `t3tui-linux-arm64.gz` / `t3tui-linux-arm64-musl.gz` | Linux aarch64, glibc / musl |
| `t3tui-darwin-x64.gz` / `t3tui-darwin-arm64.gz` | macOS, Intel / Apple Silicon |
| `t3tui-windows-x64.exe.gz` | Windows x64 |

```sh
base=https://github.com/venomade/t3tui/releases/latest/download
curl -fsSLO "$base/SHA256SUMS" -O "$base/t3tui-linux-x64.gz"
grep t3tui-linux-x64.gz SHA256SUMS | sha256sum -c -   # verify before running
gunzip t3tui-linux-x64.gz && chmod +x t3tui-linux-x64 && mv t3tui-linux-x64 ~/.local/bin/t3tui
```

On Windows, download `t3tui-windows-x64.exe.gz`, decompress it (git bash's `gunzip`, or 7-Zip), and put `t3tui.exe` somewhere on your `PATH`.

The binary is self-contained — no Bun, no checkout, nothing else to install. `t3tui upgrade` replaces it with the latest release (verified against `SHA256SUMS`), and `t3tui version` says which you have. Each release notes the T3 Code version it was built against.

With nix — this repo is a flake that builds the binary itself (`packages.<system>.t3tui`, also as `apps.t3tui`):

```nix
{
  inputs.t3tui.url = "git+https://git.venomade.com/venomade/t3tui.git"; # or the GitHub mirror
  # in home-manager: home.packages = [ inputs.t3tui.packages.${system}.t3tui ];
}
```

### Build from source

On other systems, or to run unreleased changes, you need [Bun](https://bun.sh) 1.3.14 or later:

```sh
git clone --recurse-submodules https://github.com/callumalpass/t3tui.git && cd t3tui
bun install          # also links the pinned T3 Code packages into node_modules and builds dist/
bun link             # optional: puts `t3tui` on your PATH
```

After pulling changes, run `bun run build` (or `bun install`) to rebuild.

## Use

```sh
t3tui                 # dashboard: threads on the left, the selected thread on the right
t3tui attach <thread> # one thread, full screen (id, short id from `t3tui list`, or title text)
t3tui list [--json]   # print threads and exit
t3tui tmux [--watch]  # mirror active threads into a tmux session, one window each (not on Windows)
```

The message box is always at the bottom. t3tui has two modes: **typing**, where keys go to the message box, and **navigation**, where single keys act. `esc` switches to navigation; `i`, `enter` or `tab` switch back.

The keys you'll use most:

| Key | Action |
| --- | --- |
| `ctrl+k` | command palette: every action, with its key, plus thread search |
| `ctrl+n` / `ctrl+p` | next / previous thread (`j`/`k` in navigation) |
| `enter` | send; while the agent runs, steer it mid-run |
| `alt+enter` | queue the message for after the run |
| `y` / `Y` / `n` | approve / always allow this session / decline |
| `S` | stop the thread |
| `D` | view the latest turn's changes |
| `P` | view the thread's pull request |
| `c` | new thread |
| `m` | model, reasoning and access mode |
| `.` | thread actions: pin, snooze, rename, archive… |
| `ctrl+j` | the thread's terminals on the server, in a drawer below the message box |
| `ctrl+\` | the panes' prefix: then `ctrl+\` moves the keys between a terminal or editor and the conversation, `tab` to the next pane, `1`–`9` picks a tab, `x` closes it, `z` zooms, `n` opens a terminal |
| `ctrl+g` | write the message in `$EDITOR`, in the message box's place |
| `d` | show or hide the right-hand column: details, the workspace's files, a tab per open editor or preview, and terminals placed at the side |
| `F` | browse the workspace's files: `/` searches, `enter` opens, `p` previews, `m` mentions it in the message |
| `ctrl+v` | in the message box: attach the clipboard's image (or paste its text) |
| `ctrl+c` / `q` | quit — asks `y`/`n` first |

In the message box, `/`, `$`, `@` and `#` suggest commands, skills, files and threads, and pull requests. Most things also work with the mouse.

See [docs/reference.md](docs/reference.md) for every key, the message box, diffs, git, terminals, worktrees, alerts and settings.

## How it connects

t3tui finds the local T3 Code server from `~/.t3/userdata/server-runtime.json` (override with `T3TUI_SERVER`). On first run it issues itself a session with `t3 auth session issue --label t3tui`, scoped to what it needs, and stores it in `~/.config/t3tui/credentials.json`. Revoke it any time with `t3 auth session revoke`. For a remote server, pass a token in `T3TUI_TOKEN`.

No desktop app needed: if no local server answers when t3tui starts, it runs `t3 serve` itself (the `t3` CLI from your T3 Code install, found via `T3TUI_T3_BIN`, `~/.t3/bin/t3`, or `PATH`) and stops that server again on quit. Its output goes to `~/.config/t3tui/server.log`. If a server is already running, t3tui just connects to it.

The scopes, the protocol and how to update for a newer T3 Code are in [docs/development.md](docs/development.md).

## Not yet supported

Reviewing or commenting on pull request diffs, and the project settings editor. Use the T3 Code app for those.

## Licence

[MIT](LICENSE). T3 Code, pulled in as a submodule under `vendor/t3code`, is also MIT.
