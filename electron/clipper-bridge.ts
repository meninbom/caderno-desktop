import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app, safeStorage } from "electron";
import { NotesRepo, NotebooksRepo } from "./repo/sqlite";
import { isPairChallengeValid, isStoredTokenValid, PAIR_TTL_MS, TOKEN_TTL_MS, PairChallenge } from "./clipper-protocol";
import { clipErrorStatus, MAX_CLIP_BYTES, parseClipRequest, prepareClip } from "./clipper-capture";
import type {ClipCommitInput} from "./clipper-commit";

const PORT = 43187;
type Repos = { notes: NotesRepo; notebooks: NotebooksRepo };

export class ClipperBridge {
  private server: Server | null = null;
  private token: string | null = null;
  private origin: string | null = null;
  private pending: PairChallenge | null = null;
  private tokenExpiresAt = 0;
  private usedNonces = new Set<string>();
  private tokenPath = path.join(app.getPath("userData"), "clipper-token.bin");
  private captureQueue:Promise<void>=Promise.resolve();
  constructor(private repos: Repos, private onCapture: () => void = () => {},private beforeAppend?:(noteId:string)=>Promise<()=>void>) { this.loadToken(); }
  private async commit(input:ClipCommitInput){
    const prior=this.captureQueue;let unlock!:()=>void;this.captureQueue=new Promise<void>(resolve=>{unlock=resolve;});
    await prior;
    let release:(()=>void)|undefined;
    try{if(input.appendToNoteId)release=await this.beforeAppend?.(input.appendToNoteId);return this.repos.notes.commitClip(input);}
    finally{try{release?.();}finally{unlock();}}
  }
  private loadToken() {
    try {
      if (!safeStorage.isEncryptionAvailable()) return;
      const saved = fs.readFileSync(this.tokenPath);
      const value = safeStorage.decryptString(saved);
      const parsed = JSON.parse(value);
      if (isStoredTokenValid(parsed)) { this.token = parsed.token; this.origin = parsed.origin; this.tokenExpiresAt = parsed.expiresAt; }
    } catch { /* no token yet */ }
  }
  private saveToken() {
    if (!safeStorage.isEncryptionAvailable() || !this.token || !this.origin) throw new Error("O armazenamento seguro do Windows não está disponível.");
    const temp = `${this.tokenPath}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temp, safeStorage.encryptString(JSON.stringify({ token: this.token, origin: this.origin, expiresAt: this.tokenExpiresAt })), { flag: "wx" });
    fs.renameSync(temp, this.tokenPath);
  }
  async enable(): Promise<{ port: number }> {
    if (this.server) return { port: PORT };
    if (!safeStorage.isEncryptionAvailable()) throw new Error("O armazenamento seguro do Windows não está disponível; o Clipper não foi ativado.");
    const s = createServer((req, res) => { void this.handle(req, res); });
    await new Promise<void>((resolve, reject) => {
      s.once("error", reject); s.listen(PORT, "127.0.0.1", () => { s.removeListener("error", reject); resolve(); });
    });
    this.server = s;
    return { port: PORT };
  }
  startPairing() {
    if (!this.server) throw new Error("Ative o Clipper antes de parear.");
    const digits = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
    this.pending = { code: digits, nonce: crypto.randomBytes(24).toString("hex"), expires: Date.now() + PAIR_TTL_MS };
    return { code: digits, nonce: this.pending.nonce, expiresAt: this.pending.expires };
  }
  status() {
    const paired = !!this.token && Date.now() < this.tokenExpiresAt;
    return { enabled: !!this.server, paired, port: this.server ? PORT : null };
  }
  async revoke(): Promise<void> {
    this.token = null; this.origin = null; this.tokenExpiresAt = 0; this.pending = null; this.usedNonces.clear();
    try { fs.rmSync(this.tokenPath, { force: true }); } catch { /* best effort */ }
    await this.close();
  }
  close(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.pending = null;
    if (!server || !server.listening) return Promise.resolve();
    return new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
  private send(res: ServerResponse, code: number, body: unknown, origin?: string) {
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...(origin && (origin === this.origin || /^chrome-extension:\/\/[a-p]{32}$/.test(origin)) ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : {}) });
    res.end(JSON.stringify(body));
  }
  private async readJson(req: IncomingMessage): Promise<any> {
    const chunks: Buffer[] = []; let size = 0;
    for await (const part of req) { const b = Buffer.from(part); size += b.length; if (size > MAX_CLIP_BYTES) throw new Error("PAYLOAD_TOO_LARGE"); chunks.push(b); }
    if (!size || !/application\/json/i.test(String(req.headers["content-type"] ?? ""))) throw new Error("JSON_REQUIRED");
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  private async handle(req: IncomingMessage, res: ServerResponse) {
    const host = String(req.headers.host ?? "");
    const origin = String(req.headers.origin ?? "");
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (host !== `127.0.0.1:${PORT}` && host !== `localhost:${PORT}`) return this.send(res, 403, { error: "HOST_NOT_ALLOWED" });
    if (req.method === "OPTIONS") {
      const pairingPreflight = url.pathname === "/v1/pair" && Boolean(this.pending && Date.now() < this.pending.expires) && /^chrome-extension:\/\/[a-p]{32}$/.test(origin) && req.headers["access-control-request-method"] === "POST";
      if (origin !== this.origin && !pairingPreflight) return this.send(res, 403, { error: "ORIGIN_NOT_ALLOWED" });
      const allowedOrigin = pairingPreflight ? origin : this.origin!;
      res.writeHead(204, { "Access-Control-Allow-Origin": allowedOrigin, "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Authorization,Content-Type", "Access-Control-Max-Age": "60", "Vary": "Origin" }); return res.end();
    }
    if (req.method !== "POST" && req.method !== "GET") return this.send(res, 405, { error: "METHOD_NOT_ALLOWED" });
    if (url.pathname === "/v1/pair" && req.method === "POST") {
      const fetchSite = String(req.headers["sec-fetch-site"] ?? "");
      if (!/^chrome-extension:\/\/[a-p]{32}$/.test(origin) || !["", "none", "cross-site"].includes(fetchSite)) return this.send(res, 403, { error: "EXTENSION_ORIGIN_REQUIRED" });
      try {
        const body = await this.readJson(req); const p = this.pending;
        if (!isPairChallengeValid(p, body.code, body.nonce) || this.usedNonces.has(p!.nonce)) return this.send(res, 401, { error: "PAIRING_EXPIRED_OR_INVALID" });
        this.usedNonces.add(p.nonce); this.pending = null;
        this.token = crypto.randomBytes(32).toString("hex"); this.origin = origin; this.tokenExpiresAt = Date.now() + TOKEN_TTL_MS; this.saveToken();
        return this.send(res, 200, { token: this.token }, origin);
      } catch (e) { return this.send(res, e instanceof Error && e.message === "PAYLOAD_TOO_LARGE" ? 413 : 400, { error: "PAIRING_INVALID" }); }
    }
    if (this.token && Date.now() >= this.tokenExpiresAt) { void this.revoke().catch(() => {}); return this.send(res, 401, { error: "TOKEN_EXPIRED" }); }
    if (!this.token || !this.origin || origin !== this.origin) return this.send(res, 403, { error: "ORIGIN_NOT_PAIRED" });
    const auth = String(req.headers.authorization ?? "");
    if (!crypto.timingSafeEqual(Buffer.from(auth.padEnd(71).slice(0, 71)), Buffer.from(`Bearer ${this.token}`.padEnd(71).slice(0, 71))) || auth !== `Bearer ${this.token}`) return this.send(res, 401, { error: "UNAUTHORIZED" });
    if (url.pathname === "/v1/destinations" && (req.method === "GET" || req.method === "POST")) {
      return this.send(res, 200, {
        notebooks: this.repos.notebooks.list().map(n => ({ id: n.id, name: n.name })),
        tags: this.repos.notes.listClipTags(),
        capabilities: ["article", "selection", "page", "bookmark", "append", "tags", "idempotent"],
      }, origin);
    }
    if (url.pathname === "/v1/notes" && req.method === "POST") {
      try {
        const body = await this.readJson(req);
        if (!body || typeof body.query !== "string" || body.query.length > 80) return this.send(res, 400, { error: "INVALID_QUERY" }, origin);
        return this.send(res, 200, { notes: this.repos.notes.searchClipTitles(body.query) }, origin);
      } catch (e) { return this.send(res, e instanceof Error && e.message === "PAYLOAD_TOO_LARGE" ? 413 : 400, { error: "INVALID_QUERY" }, origin); }
    }
    if (url.pathname === "/v1/clip" && req.method === "POST") {
      try {
        const parsed = parseClipRequest(await this.readJson(req));
        if (!parsed.ok) return this.send(res, 400, { error: parsed.error }, origin);
        const prepared = prepareClip(parsed.value);
        const result = await this.commit({
          requestId: parsed.value.requestId,
          notebookId: parsed.value.appendToNoteId ? null : parsed.value.notebookId,
          title: prepared.title,
          contentHtml: prepared.contentHtml,
          sourceUrl: prepared.sourceUrl,
          canonicalUrl: prepared.canonicalUrl,
          mode: parsed.value.mode,
          contentHash: prepared.contentHash,
          confirmNew: parsed.value.confirmNew,
          appendToNoteId: parsed.value.appendToNoteId,
          tags: parsed.value.tags,
        });
        if (!result.duplicate && !result.idempotent) this.onCapture();
        return this.send(res, result.duplicate || result.idempotent ? 200 : 201, { ok: true, duplicate: result.duplicate, idempotent: result.idempotent, trashed: result.trashed, title: result.title, noteId: result.noteId }, origin);
      } catch (e) {
        const failure = clipErrorStatus(e);
        return this.send(res, failure.status, { error: failure.error }, origin);
      }
    }
    return this.send(res, 404, { error: "NOT_FOUND" }, origin);
  }
}
