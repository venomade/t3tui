// Exposes the pinned T3 Code workspace packages under node_modules/@t3tools so
// their package export maps resolve. They are TypeScript sources Bun runs as-is.
// The packages are copied (not symlinked) so the small set of classic-tsc
// false positives below can be patched in the copy; vendor/ itself stays pristine.
import { chmod, cp, lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const packagesDir = join(root, "vendor/t3code/packages");
const scopeDir = join(root, "node_modules/@t3tools");
await mkdir(scopeDir, { recursive: true });
for (const name of await readdir(packagesDir)) {
  const dest = join(scopeDir, name);
  await lstat(dest).then(() => rm(dest, { recursive: true, force: true }), () => {});
  await cp(join(packagesDir, name), dest, { recursive: true });
}

// Upstream type-checks these sources with effect-tsgo plus the Effect language
// service, which infers callback parameter types classic tsc cannot. Patch the
// copies so `bun run typecheck` (classic tsc) stays clean. Each entry is applied
// only if the original text is still present; if an upstream bump changes the
// code, re-run typecheck and update the list.
const tscPatches: ReadonlyArray<{ file: string; from: string; to: string }> = [
  {
    file: "client-runtime/src/rpc/session.ts",
    from: "send: (clientId, request, transferables) =>",
    to: "send: (clientId: any, request: any, transferables: any) =>",
  },
];
for (const { file, from, to } of tscPatches) {
  const path = join(scopeDir, file);
  const source = await readFile(path, "utf8");
  // Copies keep the source's mode; a read-only store path (nix flake input) must be writable here.
  if (source.includes(from)) {
    await chmod(path, 0o644);
    await writeFile(path, source.replace(from, to));
  }
}

// Upstream resolves "@pierre/words/core" and "@pierre/words/wasm" through its web app's
// tsconfig paths (apps/web/tsconfig.json), not through the package's exports map. Bun does
// not apply those paths to files under vendor/, so add the two subpaths to the installed
// package's exports here. The files ship in the tgz (dist/core.js, dist/words.wasm.mjs).
const wordsManifest = join(root, "node_modules/@pierre/words/package.json");
try {
  const manifest = JSON.parse(await readFile(wordsManifest, "utf8")) as {
    exports?: Record<string, unknown>;
  };
  if (manifest.exports && !("./core" in manifest.exports)) {
    manifest.exports["./core"] = {
      types: "./dist/core.d.ts",
      import: "./dist/core.js",
      default: "./dist/core.js",
    };
    manifest.exports["./wasm"] = "./dist/words.wasm.mjs";
    await writeFile(wordsManifest, `${JSON.stringify(manifest, null, 2)}\n`);
  }
} catch {
  // @pierre/words not installed yet; nothing to patch.
}
