// Copies the single-threaded Stockfish WASM build into public/ so the browser can run it
// in a Web Worker (single-threaded = no SharedArrayBuffer / COOP+COEP headers needed).
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "stockfish", "src");
const dest = join(root, "public", "stockfish");

if (!existsSync(src)) {
  console.warn("[copy-stockfish] stockfish package not installed; skipping");
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
const files = readdirSync(src).filter((f) => /^stockfish-.*-lite-single-[0-9a-f]+\.(js|wasm)$/.test(f));
for (const f of files) {
  // Keep the original base name: the JS loader finds its .wasm by swapping the extension.
  copyFileSync(join(src, f), join(dest, f));
}
console.log(`[copy-stockfish] copied ${files.join(", ")}`);
