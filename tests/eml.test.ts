import { describe, expect, it } from "vitest";
import { parseEml, emlHtml } from "../electron/repo/eml";

const fixture = [
  "From: =?UTF-8?Q?Jo=C3=A3o_Exemplo?= <joao@example.test>",
  "To: equipe@example.test",
  "Subject: =?UTF-8?Q?Relat=C3=B3rio_=E2=9C=93?=",
  "Message-ID: <fixture-42@example.test>",
  "Date: Tue, 28 Oct 2026 12:00:00 +0000",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="outer"',
  "",
  "--outer",
  'Content-Type: multipart/alternative; boundary="inner"',
  "",
  "--inner",
  "Content-Type: text/plain; charset=utf-8",
  "Content-Transfer-Encoding: quoted-printable",
  "",
  "Ol=C3=A1, mundo!",
  "--inner",
  "Content-Type: text/html; charset=utf-8",
  "",
  '<h1>Mensagem</h1><script>window.evil=1</script><img src="https://tracker.invalid/pixel"><a href="javascript:alert(1)">link</a>',
  "--inner--",
  "--outer",
  'Content-Type: application/octet-stream; name="..\\..\\segredo.bin"',
  'Content-Disposition: attachment; filename="..\\..\\segredo.bin"',
  "Content-Transfer-Encoding: base64",
  "",
  "AQIDBA==",
  "--outer--",
  "",
].join("\r\n");

describe("importação EML local", () => {
  it("decodifica headers UTF-8, quoted-printable e anexo base64; sanitiza HTML remoto/hostil", async () => {
    const mail = await parseEml(Buffer.from(fixture, "utf8"), "fixture.eml");
    expect(mail.subject).toBe("Relatório ✓");
    expect(mail.from).toContain("João Exemplo");
    expect(mail.text).toContain("Olá, mundo!");
    expect(mail.messageId).toBe("<fixture-42@example.test>");
    expect(mail.attachments[0].fileName).toBe("segredo.bin");
    expect(mail.attachments[0].content).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(mail.html).toContain("<h1>Mensagem</h1>");
    expect(mail.html).not.toMatch(/script|tracker\.invalid|javascript:/i);
    expect(emlHtml(mail)).toContain('data-eml-key="mid:&lt;fixture-42@example.test&gt;"');
  });

  it("recusa arquivo vazio ou acima do limite antes do parser", async () => {
    await expect(parseEml(Buffer.alloc(0))).rejects.toThrow(/25 MB/);
    await expect(parseEml(Buffer.alloc(25 * 1024 * 1024 + 1))).rejects.toThrow(/25 MB/);
  });

  it("fallback hash identifica cópia sem Message-ID", async () => {
    const raw = Buffer.from("From: a@example.test\r\nSubject: x\r\n\r\nbody");
    const a = await parseEml(raw), b = await parseEml(raw);
    expect(a.messageId).toBeNull();
    expect(a.key).toBe(b.key);
  });
  it("recusa excesso de partes e de níveis MIME",async()=>{
    const tooMany=Buffer.from(Array.from({length:121},(_,i)=>`Content-Type: text/plain\r\n\r\npart ${i}`).join("\r\n"));
    const tooDeep=Buffer.from(Array.from({length:21},(_,i)=>`Content-Type: multipart/mixed; boundary=\"b${i}\"`).join("\r\n"));
    await expect(parseEml(tooMany)).rejects.toThrow(/partes MIME/);
    await expect(parseEml(tooDeep)).rejects.toThrow(/aninhamento MIME/);
  });
});
