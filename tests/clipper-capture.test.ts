import { describe, expect, it } from "vitest";
import { canonicalClipUrl, clipErrorStatus, clipPayloadBytes, MAX_CLIP_BYTES, parseClipRequest, prepareClip, type ClipRequest } from "../electron/clipper-capture";

function request(patch: Partial<ClipRequest> = {}): ClipRequest {
  return {
    requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    title: "Receita",
    text: "Misture farinha",
    html: "<p>Misture farinha</p>",
    sourceURL: "https://example.test/artigo",
    sourceDate: "2024-05-01",
    sourceDateKind: "publicação",
    mode: "article",
    notebookId: null,
    comment: "",
    author: "",
    tags: [],
    confirmNew: false,
    appendToNoteId: null,
    ...patch,
  };
}

describe("captura do Clipper", () => {
  it("mantém tabela, lista e link absoluto e remove script, evento e javascript", () => {
    const prepared = prepareClip(request({
      sourceURL: "https://example.test/artigo/1",
      html: `<article><h1>Artigo limpo</h1><p>Conteudo benigno para captura local.</p><a href="/dicas" onclick="alert(1)">dicas</a><a href="javascript:alert(1)">ruim</a><img src="http://127.0.0.1:1/tracker"><script>document.body.dataset.scriptRan='yes'</script><table><tr><td>500 g</td></tr></table><p>ação</p></article>`,
      comment: "ver <script>",
      author: "Ana",
    }), new Date("2026-11-01T12:00:00.000Z"));
    expect(prepared.contentHtml).toContain("Artigo limpo");
    expect(prepared.contentHtml).toContain("<table>");
    expect(prepared.contentHtml).toContain("500 g");
    expect(prepared.contentHtml).toContain("ação");
    expect(prepared.contentHtml).toContain('href="https://example.test/dicas"');
    expect(prepared.contentHtml).toContain("Autor: Ana");
    expect(prepared.contentHtml).toContain("&lt;script&gt;");
    expect(prepared.contentHtml).not.toMatch(/<script/i);
    expect(prepared.contentHtml).not.toMatch(/<img/i);
    expect(prepared.contentHtml).not.toMatch(/javascript:/i);
    expect(prepared.contentHtml).not.toMatch(/\son\w+=/i);
    expect(prepared.contentHtml).not.toContain("scriptRan");
  });

  it("guarda a URL original e deduplica só o rastreamento conhecido", () => {
    const source = new URL("https://Example.com/a?utm_source=boletim&id=3&fbclid=abc#trecho");
    expect(canonicalClipUrl(source)).toBe("https://example.com/a?id=3#trecho");
    const prepared = prepareClip(request({ sourceURL: source.href }));
    expect(prepared.sourceUrl).toContain("utm_source=boletim");
    expect(prepared.canonicalUrl).toBe("https://example.com/a?id=3#trecho");
    expect(prepared.contentHtml).toContain("utm_source=boletim");
  });

  it("recusa URL com senha, comentário longo e mede o JSON em bytes", () => {
    expect(() => prepareClip(request({ sourceURL: "https://user:secret@example.test/a" }))).toThrow(/INVALID_SOURCE_URL/);
    expect(parseClipRequest(request({ comment: "x".repeat(2001) }))).toMatchObject({ ok: false, error: "COMMENT_TOO_LONG" });
    expect(parseClipRequest(request({ mode: "bookmark" })).ok).toBe(true);
    const heavy = "ã".repeat(500_000);
    expect(heavy.length).toBeLessThan(600_000);
    expect(clipPayloadBytes({ text: heavy })).toBeGreaterThan(MAX_CLIP_BYTES);
    expect(clipErrorStatus(new Error("NOTE_TRASHED"))).toEqual({ status: 409, error: "NOTE_TRASHED" });
    expect(clipErrorStatus(new Error("SQLITE_ERROR: no such table"))).toEqual({ status: 400, error: "INVALID_CLIP" });
  });
});
