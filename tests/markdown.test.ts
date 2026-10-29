import { describe, expect, it } from "vitest";
import { markdownToNoteHtml, markdownFromNote } from "../electron/repo/markdown";
import { extractPreviewHtml, extractVisibleText } from "../electron/repo/db";
import { validateInput } from "../shared/api";
import { FindNotesInputSchema, ImportMarkdownInputSchema, ListNotesQuerySchema, RestoreInputSchema } from "../shared/ipc";

describe("markdownToNoteHtml", () => {
  it("converte títulos, listas, checklist, código e ênfase", () => {
    const html = markdownToNoteHtml([
      "# Título",
      "",
      "- item",
      "- [x] tarefa feita",
      "1. primeiro",
      "",
      "`code` e **bold** e *itálico*",
      "```",
      "const a = 1;",
      "```",
    ].join("\n"));
    expect(html).toContain("<h1>Título</h1>");
    expect(html).toContain("<ul>");
    expect(html).toContain('data-checked="true"');
    expect(html).toContain("<ol>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>itálico</em>");
    expect(html).toContain("const a = 1;");
  });

  it("escapa HTML cru no markdown", () => {
    const html = markdownToNoteHtml("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("markdownFromNote", () => {
  it("deriva MD de nota com checklist e link", () => {
    const md = markdownFromNote({
      title: "Nota X",
      contentHtml: '<p>Texto <strong>forte</strong></p><ul data-type="taskList"><li data-checked="true"><p>feito</p></li><li data-checked="false"><p>falta</p></li></ul><p>veja <a href="https://example.com">exemplo</a></p>',
      contentText: "",
      tags: [{ id: 1, name: "ideias" }],
      notebookName: "Pessoal",
      createdAt: 0,
      updatedAt: 0,
    });
    expect(md.startsWith("# Nota X"));
    expect(md).toContain("Caderno: Pessoal");
    expect(md).toContain("Etiquetas: ideias");
    expect(md).toContain("**forte**");
    expect(md).toContain("- [x] feito");
    expect(md).toContain("- [ ] falta");
    expect(md).toContain("[exemplo](https://example.com)");
  });
});

describe("extract helpers", () => {
  it("gera texto e preview a partir do HTML", () => {
    const html = "<h1>Plano</h1><p>Primeiro parágrafo com bastante conteúdo</p>";
    expect(extractVisibleText(html)).toContain("Plano");
    expect(extractVisibleText(html)).toContain("Primeiro parágrafo");
    expect(extractPreviewHtml(html, 10)).toBe("Plano Prim…");
  });
});

describe("validateInput (IPC)", () => {
  it("valida payload correto e rejeita inválido", () => {
    expect(validateInput("notes:list", { view: "all", query: "x" }).ok).toBe(true);
    expect(validateInput("notes:create", {}).ok).toBe(true);
    expect(validateInput("notes:list", { view: "all", query: [1, 2] }).ok).toBe(false);
    expect(validateInput("canal-inexistente", null).ok).toBe(false);
    expect(validateInput("counts:get", null).ok).toBe(true);
    expect(validateInput("notes:purge", { id: "não-é-uuid" }).ok).toBe(false);
    expect(validateInput("theme:set", { value: "neon" }).ok).toBe(false);
    expect(validateInput("theme:set", { value: "dark" }).ok).toBe(true);
    expect(validateInput("notes:emptyTrash", { roubado: true }).ok).toBe(false);
  });

  it("mantém defaults de saída e compatibilidade de UUID legado", () => {
    expect(ListNotesQuerySchema.parse({ view: "all" })).toEqual({ view: "all", order: "updated_desc" });
    expect(FindNotesInputSchema.parse({ query: "teste" })).toEqual({ query: "teste", limit: 20 });
    const legacyUuid = "00000000-0000-0000-0000-000000000001";
    expect(validateInput("notes:purge", { id: legacyUuid }).ok).toBe(true);
    expect(validateInput("events:create", { noteId: legacyUuid, title: "x", description: "", startAt: 1, endAt: 2, timeZone: "UTC", allDay: false }).ok).toBe(true);
  });

  it("limita arrays de importação grandes com erro pequeno e mantém backup legado", () => {
    const oversized = Array.from({ length: 100_000 }, () => ({ fileName: "x.md", content: "x" }));
    const result = ImportMarkdownInputSchema.safeParse({ notebookId: null, items: oversized });
    expect(result.success).toBe(false);
    if (!result.success) expect(JSON.stringify(result.error.issues).length).toBeLessThan(2_000);
    expect(RestoreInputSchema.safeParse({ json: JSON.stringify({ app: "caderno", schemaVersion: 1, notes: [] }) }).success).toBe(true);
    expect(RestoreInputSchema.safeParse({ json: "x".repeat(100_000_001) }).success).toBe(false);
  });
});
