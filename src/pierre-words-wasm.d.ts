// Upstream declares this in apps/web/src/markdown/wordsWasm.d.ts; the tgz ships the wasm as
// an .mjs with no types, and t3tui's tsconfig has no `~/*` include root for that file.
declare module "@pierre/words/wasm" {
  const bytes: Uint8Array<ArrayBuffer>;
  export default bytes;
}
