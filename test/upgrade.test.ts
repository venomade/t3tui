import { expect, test } from "bun:test";

import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assetName, checksumFor, isCompiled, isEmbeddedPath, isMuslLinux, removeOldBinaries, replaceBinary } from "../src/upgrade.ts";

test("names the release asset for a platform", () => {
  expect(assetName("darwin", "arm64")).toBe("t3tui-darwin-arm64");
  expect(assetName("win32", "x64")).toBe("t3tui-windows-x64.exe");
  expect(assetName("linux", "x64", false)).toBe("t3tui-linux-x64");
  // musl systems (Alpine, containers) get the musl asset.
  expect(assetName("linux", "x64", true)).toBe("t3tui-linux-x64-musl");
  expect(assetName("linux", "arm64", true)).toBe("t3tui-linux-arm64-musl");
});

test("detects musl by the loader's triplet name, not Node's arch name", () => {
  // process.arch is "x64"/"arm64", but the loader is ld-musl-x86_64.so.1 / ld-musl-aarch64.so.1.
  expect(isMuslLinux(() => ["ld-musl-x86_64.so.1", "libc.musl-x86_64.so.1"])).toBe(true);
  expect(isMuslLinux(() => ["ld-musl-aarch64.so.1"])).toBe(true);
  expect(isMuslLinux(() => ["ld-linux-x86-64.so.2", "libc.so.6"])).toBe(false);
  expect(isMuslLinux(() => [])).toBe(false);
  expect(isMuslLinux(() => { throw new Error("no /lib"); })).toBe(false);
});

test("knows Bun's embedded filesystem on every platform", () => {
  expect(isEmbeddedPath("/$bunfs/root/t3tui-linux-x64")).toBe(true);
  expect(isEmbeddedPath("B:\\~BUN\\root\\t3tui-windows-x64.exe")).toBe(true);
  expect(isEmbeddedPath("B:/~BUN/root/t3tui-windows-x64.exe")).toBe(true);
  expect(isEmbeddedPath("/home/me/t3tui/src/upgrade.ts")).toBe(false);
  expect(isEmbeddedPath("C:\\t3tui\\src\\upgrade.ts")).toBe(false);
});

test("on Windows, moves the old binary aside and removes it on the next start", async () => {
  const dir = mkdtempSync(join(tmpdir(), "t3tui-upgrade-"));
  const target = join(dir, "t3tui.exe");
  writeFileSync(target, "old");
  writeFileSync(join(dir, "notes.txt"), "mine");
  await replaceBinary(target, new TextEncoder().encode("new"), "win32");
  expect(readFileSync(target, "utf8")).toBe("new");
  expect(readdirSync(dir).filter((name) => name.includes(".old-"))).toHaveLength(1);
  removeOldBinaries(target);
  expect(readdirSync(dir).sort()).toEqual(["notes.txt", "t3tui.exe"]);
});

test("elsewhere, renames straight over the binary", async () => {
  const dir = mkdtempSync(join(tmpdir(), "t3tui-upgrade-"));
  const target = join(dir, "t3tui");
  writeFileSync(target, "old");
  await replaceBinary(target, new TextEncoder().encode("new"), "linux");
  expect(readFileSync(target, "utf8")).toBe("new");
  expect(readdirSync(dir)).toEqual(["t3tui"]);
  expect(existsSync(`${target}.upgrade-${process.pid}`)).toBe(false);
});

test("reads a hash from a sha256sum listing", () => {
  const sums = "aaa  t3tui-linux-x64.gz\nbbb *t3tui-darwin-arm64.gz\n";
  expect(checksumFor(sums, "t3tui-linux-x64.gz")).toBe("aaa");
  expect(checksumFor(sums, "t3tui-darwin-arm64.gz")).toBe("bbb");
  expect(checksumFor(sums, "t3tui-linux-arm64.gz")).toBeUndefined();
});

test("knows it's running from source", () => {
  expect(isCompiled()).toBe(false);
});
