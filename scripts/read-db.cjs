/**
 * Inspeção somente-leitura do banco real do app (userData), para validação de
 * que a persistência é SQLite. Não modifica dados.
 * Uso: ELECTRON_RUN_AS_NODE=1 electron scripts/read-db.cjs
 */
const path = require("node:path");
const repo = require(process.env.CADERNO_SEED_MODULE);
const userData = process.env.CADERNO_USER_DATA;
const db = repo.openDatabase({
  database: path.join(userData, "caderno.sqlite"),
  attachments: path.join(userData, "attachments"),
});
const notes = new repo.NotesRepo(db);
const notebooks = new repo.NotebooksRepo(db);
const tags = new repo.TagsRepo(db);
const counts = new repo.CountsRepo(db);
const all = notes.list({ view: "all" });
console.log(
  JSON.stringify(
    {
      counts: counts.get(),
      notebooks: notebooks.list().map((n) => ({ id: n.id, name: n.name, noteCount: n.noteCount })),
      tags: tags.list(),
      notes: all.map((n) => ({
        title: n.title || "(sem título)",
        notebookId: n.notebookId,
        favorited: n.favorited,
        pinned: n.pinned,
        tags: n.tags.map((t) => t.name),
      })),
    },
    null,
    2
  )
);
db.close();
