import { build } from "esbuild";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(root, "..", "dist-electron");
fs.mkdirSync(outDir, { recursive: true });

for (const entry of ["main.ts", "preload.ts", "attachment-worker.ts", "transcription-worker.ts"]) {
  await build({
    entryPoints: [path.join(root, "..", "electron", entry)],
    outfile: path.join(outDir, entry.replace(/\.ts$/, ".cjs")),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["electron", "better-sqlite3", "pdfjs-dist/legacy/build/pdf.mjs"],
    sourcemap: false,
    logLevel: "info",
  });
}
console.log("electron build ok");
fs.copyFileSync(path.join(root, "..", "electron", "ocr-winrt.ps1"), path.join(outDir, "ocr-winrt.ps1"));
