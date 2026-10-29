import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(root, "..");
const scriptArgs = process.argv.slice(2);
const watch = scriptArgs.includes("--watch");
const electron = path.join(project, "node_modules", "electron", "dist", "electron.exe");
const vitest = path.join(project, "node_modules", "vitest", "vitest.mjs");

const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
const args = [vitest, "run", ...(watch ? ["--watch"] : [])];
const result = spawnSync(electron, args, { stdio: "inherit", env, cwd: project });
process.exit(result.status ?? 1);
