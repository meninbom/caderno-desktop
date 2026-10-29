import { describe, expect, it } from "vitest";
import { parseSearchQuery, toFtsExpression } from "../shared/search";

describe("search query parser", () => {
  it("parses combinable quoted filters and keeps ordinary words", () => {
    expect(parseSearchQuery('café notebook:"Projetos pessoais" tag:"ação rápida" before:2026-12-31 after:2026-01-01 type:note'))
      .toEqual({ text: "café", notebook: "Projetos pessoais", tags: ["ação rápida"], before: "2026-12-31", after: "2026-01-01", type: "note" });
  });
  it("supports escapes and reports malformed dates, types and quotes", () => {
    expect(parseSearchQuery('texto notebook:Casa\\:Nova').notebook).toBe("Casa:Nova");
    expect(() => parseSearchQuery("before:2026-02-30")).toThrow(/Data inválida/);
    expect(() => parseSearchQuery("type:script")).toThrow(/Tipo inválido/);
    expect(() => parseSearchQuery('notebook:"sem fim')).toThrow(/aspas sem fechamento/);
    expect(() => parseSearchQuery("tag:")).toThrow(/informe um valor/);
  });
  it("turns input into literal FTS syntax and handles diacritics", () => {
    expect(toFtsExpression('ação " OR * :')).toBe('"ação" AND "OR"');
  });
});
