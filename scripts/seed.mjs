/**
 * Semear dados de demonstração no banco do app.
 * Roda o Electron como runtime Node (ELECTRON_RUN_AS_NODE=1), que é o ABI
 * para o qual o better-sqlite3 é compilado neste projeto.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import fs from "node:fs";

const root = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(root, "..");
const electron = path.join(project, "node_modules", "electron", "dist", "electron.exe");

const seedSource = `
const path = require("node:path");
const fs = require("node:fs");
const repo = require(process.env.CADERNO_SEED_MODULE);
const userData = process.env.CADERNO_USER_DATA;
const dbPath = path.join(userData, "caderno.sqlite");
fs.mkdirSync(userData, { recursive: true });
fs.mkdirSync(path.join(userData, "attachments"), { recursive: true });
const db = repo.openDatabase({ database: dbPath, attachments: path.join(userData, "attachments") });
const notebooks = new repo.NotebooksRepo(db);
const notes = new repo.NotesRepo(db);
const tags = new repo.TagsRepo(db);
const nb = notebooks.create("Pessoal");
const nb2 = notebooks.create("Trabalho");
const welcome = notes.create({ notebookId: nb.id, title: "Bem-vindo ao Caderno", contentHtml: "<h1>Bem-vindo</h1><p>Este é o seu primeiro passo. Crie cadernos, etiquete tudo e favorite o que mais importa.</p><ul><li>Crie <strong>cadernos</strong> na barra lateral</li><li>Use <strong>etiquetas</strong> para conectar assuntos entre cadernos</li><li>Tarefas rápidas viram <em>checklists</em></li></ul>" });
const market = notes.create({ notebookId: nb.id, title: "Lista do mercado", contentHtml: '<ul data-type="taskList"><li data-checked="false"><p>Café</p></li><li data-checked="true"><p>Leite</p></li><li data-checked="false"><p>Pão integral</p></li></ul><p>Orçamento: <strong>R$ 120</strong></p>' });
const meeting = notes.create({ notebookId: nb2.id, title: "Roteiro da reunião", contentHtml: "<h2>Segunda-feira</h2><ul><li>Revisão das metas do trimestre</li><li>Onboarding de novos clientes</li></ul><blockquote>Ideias valem pouco sem execução.</blockquote>" });
notes.setFlag(welcome.id, "favorited", true);
notes.setFlag(meeting.id, "pinned", true);
const t = tags.create("ideias");
tags.attach(meeting.id, t.id);
notes.update(welcome.id, { contentHtml: "<h1>Bem-vindo</h1><p>Este é o seu primeiro passo. Crie cadernos, etiquete tudo e favorite o que mais importa.</p><ul><li>Crie <strong>cadernos</strong> na barra lateral</li><li>Use <strong>etiquetas</strong> para conectar assuntos entre cadernos</li><li>Tarefas rápidas viram <em>checklists</em></li></ul>" });
console.log("[seed] banco criado em:", dbPath);
process.exit(0);
`;

fs.writeFileSync(path.join(project, "scripts", "dist-seed.cjs"), seedSource, "utf8");
await build({
  entryPoints: [path.join(project, "scripts", "seed-repo-entry.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: path.join(project, "scripts", "dist-seed-repo.cjs"),
  external: ["better-sqlite3", "electron"],
  logLevel: "silent",
});

const env = { ...process.env };
env.ELECTRON_RUN_AS_NODE = "1";
env.CADERNO_SEED_MODULE = path.join(project, "scripts", "dist-seed-repo.cjs");
env.CADERNO_USER_DATA = process.env.CADERNO_USER_DATA || path.join(process.env.APPDATA ?? ".", "caderno");
const result = spawnSync(electron, [path.join(project, "scripts", "dist-seed.cjs")], { env, stdio: "inherit" });
process.exit(result.status ?? 1);
