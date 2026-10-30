import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app, safeStorage } from "electron";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { NotesRepo, NotebooksRepo, TasksRepo } from "./repo/sqlite";
import {
  PAIR_CODE_ATTEMPTS,
  PAIR_CODE_TTL_MS,
  RAYCAST_PORT,
  RAYCAST_TOKEN_TTL_MS,
  hashRaycastToken,
  hasBrowserRequestHeaders,
  isAuthorizedToken,
  isLoopbackRequestAllowed,
  isPairChallengeValid,
  isValidEpochMilliseconds,
  type PairChallenge,
} from "./raycast-protocol";

const MAX_BODY_BYTES = 32_000;
const MAX_URL_CHARS = 2_048;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JSON_CONTENT_TYPE = /^application\/json(?:\s*;\s*charset=utf-8)?$/i;

interface Repositories {
  notes: NotesRepo;
  notebooks: NotebooksRepo;
  tasks: TasksRepo;
}

interface StoredToken {
  tokenHash: string;
  expiresAt: number;
}

export interface RaycastStatus {
  enabled: boolean;
  paired: boolean;
  port: number | null;
}

export class RaycastBridge {
  private server: Server | null = null;
  private tokenHash: string | null = null;
  private tokenExpiresAt = 0;
  private pending: PairChallenge | null = null;
  private readonly tokenPath = path.join(app.getPath("userData"), "raycast-token.bin");

  constructor(private readonly repos: Repositories, private readonly onOpenNote: (id: string) => void | Promise<void>, private readonly onChange: () => void) {
    this.loadToken();
  }

  get hasStoredToken(): boolean {
    return this.tokenHash !== null;
  }

  private loadToken(): void {
    try {
      if (!safeStorage.isEncryptionAvailable()) return;
      const saved = safeStorage.decryptString(fs.readFileSync(this.tokenPath));
      const parsed = JSON.parse(saved) as Partial<StoredToken>;
      if (typeof parsed.tokenHash === "string" && /^[a-f0-9]{64}$/.test(parsed.tokenHash)
        && typeof parsed.expiresAt === "number" && Number.isSafeInteger(parsed.expiresAt) && Date.now() < parsed.expiresAt) {
        this.tokenHash = parsed.tokenHash;
        this.tokenExpiresAt = parsed.expiresAt;
      } else {
        fs.rmSync(this.tokenPath, { force: true });
      }
    } catch {
      this.tokenHash = null;
      this.tokenExpiresAt = 0;
    }
  }

  private saveToken(state: StoredToken): void {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("O armazenamento seguro do Windows não está disponível.");
    const temp = `${this.tokenPath}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temp, safeStorage.encryptString(JSON.stringify(state)), { flag: "wx" });
      fs.renameSync(temp, this.tokenPath);
    } catch (error) {
      fs.rmSync(temp, { force: true });
      throw error;
    }
  }

  async enable(): Promise<{ port: number }> {
    if (this.server) return { port: RAYCAST_PORT };
    if (!safeStorage.isEncryptionAvailable()) throw new Error("O armazenamento seguro do Windows não está disponível; a integração não foi ativada.");
    const server = createServer({ maxHeaderSize: 8_192, requestTimeout: 5_000, headersTimeout: 5_000 }, (req, res) => {
      void this.handle(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(RAYCAST_PORT, "127.0.0.1", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    this.server = server;
    return { port: RAYCAST_PORT };
  }

  startPairing(): { code: string; expiresAt: number } {
    if (!this.server) throw new Error("Ative a integração Raycast antes de parear.");
    const code = crypto.randomInt(0, 10_000_000_000).toString().padStart(10, "0");
    const expiresAt = Date.now() + PAIR_CODE_TTL_MS;
    this.pending = { code, expiresAt, attempts: 0 };
    return { code, expiresAt };
  }

  status(): RaycastStatus {
    return { enabled: !!this.server, paired: !!this.tokenHash, port: this.server ? RAYCAST_PORT : null };
  }

  async revoke(): Promise<void> {
    this.tokenHash = null;
    this.tokenExpiresAt = 0;
    this.pending = null;
    fs.rmSync(this.tokenPath, { force: true });
    await this.close();
  }

  close(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.pending = null;
    if (!server || !server.listening) return Promise.resolve();
    return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }

  private send(res: ServerResponse, status: number, data: unknown): void {
    if (res.headersSent || res.destroyed) return;
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'",
    });
    res.end(JSON.stringify(data));
  }

  private async readJson(req: IncomingMessage): Promise<unknown> {
    if (!JSON_CONTENT_TYPE.test(String(req.headers["content-type"] ?? ""))) throw new Error("JSON_REQUIRED");
    const contentLength = Number(req.headers["content-length"] ?? 0);
    if (contentLength > MAX_BODY_BYTES) throw new Error("PAYLOAD_TOO_LARGE");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_BODY_BYTES) throw new Error("PAYLOAD_TOO_LARGE");
      chunks.push(buffer);
    }
    if (size === 0) throw new Error("JSON_REQUIRED");
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  }

  private jsonError(res: ServerResponse, error: unknown): void {
    const code = error instanceof Error ? error.message : "";
    if (code === "PAYLOAD_TOO_LARGE") return this.send(res, 413, { error: code });
    if (code === "JSON_REQUIRED") return this.send(res, 415, { error: code });
    this.send(res, 400, { error: "INVALID_REQUEST" });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isLoopbackRequestAllowed(req.headers.host, req.socket.remoteAddress)) return this.send(res, 403, { error: "LOOPBACK_ONLY" });
    if (hasBrowserRequestHeaders(req.headers as Record<string, unknown>)) return this.send(res, 403, { error: "BROWSER_REQUEST_NOT_ALLOWED" });
    if ((req.url?.length ?? MAX_URL_CHARS + 1) > MAX_URL_CHARS) return this.send(res, 414, { error: "URL_TOO_LONG" });

    let url: URL;
    try { url = new URL(req.url ?? "/", `http://127.0.0.1:${RAYCAST_PORT}`); }
    catch { return this.send(res, 400, { error: "INVALID_REQUEST" }); }

    if (url.pathname === "/v1/pair" && req.method === "POST") {
      if (!this.pending || Date.now() >= this.pending.expiresAt || this.pending.attempts >= PAIR_CODE_ATTEMPTS) {
        this.pending = null;
        return this.send(res, 401, { error: "PAIRING_EXPIRED_OR_INVALID" });
      }
      try {
        const body = await this.readJson(req);
        if (!body || typeof body !== "object" || Array.isArray(body)) return this.send(res, 400, { error: "INVALID_REQUEST" });
        const code = (body as Record<string, unknown>).code;
        const valid = isPairChallengeValid(this.pending, code);
        this.pending.attempts += 1;
        if (!valid) {
          if (this.pending.attempts >= PAIR_CODE_ATTEMPTS) this.pending = null;
          return this.send(res, 401, { error: "PAIRING_EXPIRED_OR_INVALID" });
        }
        const token = crypto.randomBytes(32).toString("hex");
        const state = { tokenHash: hashRaycastToken(token), expiresAt: Date.now() + RAYCAST_TOKEN_TTL_MS };
        this.saveToken(state);
        this.tokenHash = state.tokenHash;
        this.tokenExpiresAt = state.expiresAt;
        this.pending = null;
        return this.send(res, 200, { token });
      } catch (error) {
        return this.jsonError(res, error);
      }
    }

    if (req.method !== "GET" && req.method !== "POST") return this.send(res, 405, { error: "METHOD_NOT_ALLOWED" });
    if (this.tokenHash && Date.now() >= this.tokenExpiresAt) {
      this.tokenHash = null;
      this.tokenExpiresAt = 0;
      this.pending = null;
      fs.rmSync(this.tokenPath, { force: true });
      return this.send(res, 401, { error: "TOKEN_EXPIRED" });
    }
    if (!isAuthorizedToken(this.tokenHash, req.headers.authorization)) return this.send(res, 401, { error: "UNAUTHORIZED" });

    if (req.method === "GET" && url.pathname === "/v1/notes") return this.searchNotes(url, res);
    if (req.method === "GET" && url.pathname === "/v1/notebooks") {
      return this.send(res, 200, { notebooks: this.repos.notebooks.list().map(({ id, name }) => ({ id, name })) });
    }
    if (req.method === "POST" && url.pathname === "/v1/notes") return this.createNote(req, res);
    if (req.method === "POST" && url.pathname === "/v1/tasks") return this.createTask(req, res);
    if (req.method === "POST" && url.pathname === "/v1/notes/open") return this.openNote(req, res);
    this.send(res, 404, { error: "NOT_FOUND" });
  }

  private searchNotes(url: URL, res: ServerResponse): void {
    const values = url.searchParams.getAll("query");
    const query = values[0] ?? "";
    const limitValues = url.searchParams.getAll("limit");
    const rawLimit = limitValues[0] ?? "30";
    const limit = Number(rawLimit);
    if (values.length > 1 || limitValues.length > 1 || query.length > 200 || !/^\d{1,3}$/.test(rawLimit) || !Number.isInteger(limit) || limit < 1 || limit > 50) {
      return this.send(res, 400, { error: "INVALID_SEARCH" });
    }
    const notebooks = new Map(this.repos.notebooks.list().map(({ id, name }) => [id, name]));
    const notes = this.repos.notes.search(query, limit).filter(note => note.deletedAt === null).map(note => ({
      id: note.id,
      title: note.title || "Sem título",
      notebookName: note.notebookId === null ? null : notebooks.get(note.notebookId) ?? null,
      preview: (note.matchSnippet || note.preview).slice(0, 240),
      updatedAt: note.updatedAt,
    }));
    this.send(res, 200, { notes });
  }

  private async createNote(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const value = await this.readJson(req);
      if (!value || typeof value !== "object" || Array.isArray(value)) return this.send(res, 400, { error: "INVALID_REQUEST" });
      const body = value as Record<string, unknown>;
      const title = typeof body.title === "string" ? body.title.trim() : "";
      const content = body.content === undefined ? "" : body.content;
      const notebookId = body.notebookId === undefined ? null : body.notebookId;
      if (Object.keys(body).some(key => !["title", "content", "notebookId"].includes(key))
        || !title || title.length > 300 || typeof content !== "string" || content.length > 10_000
        || !(notebookId === null || (Number.isSafeInteger(notebookId) && this.repos.notebooks.list().some(book => book.id === notebookId)))) {
        return this.send(res, 400, { error: "INVALID_NOTE" });
      }
      const escaped = content.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!)
        .replace(/\r\n?|\n/g, "<br>");
      const note = this.repos.notes.create({ title, notebookId: notebookId as number | null, contentHtml: escaped ? `<p>${escaped}</p>` : "" });
      this.onChange();
      this.send(res, 201, { id: note.id, title: note.title, notebookId: note.notebookId });
    } catch (error) { this.jsonError(res, error); }
  }

  private async createTask(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const value = await this.readJson(req);
      if (!value || typeof value !== "object" || Array.isArray(value)) return this.send(res, 400, { error: "INVALID_REQUEST" });
      const body = value as Record<string, unknown>;
      const title = typeof body.title === "string" ? body.title.trim() : "";
      if (Object.keys(body).some(key => !["title", "noteId", "priority", "dueAt"].includes(key))
        || !title || title.length > 300 || typeof body.noteId !== "string" || !GUID.test(body.noteId)
        || !(body.priority === undefined || body.priority === "low" || body.priority === "normal" || body.priority === "high")
        || !(body.dueAt === undefined || body.dueAt === null || isValidEpochMilliseconds(body.dueAt))) {
        return this.send(res, 400, { error: "INVALID_TASK" });
      }
      const note = this.repos.notes.get(body.noteId);
      if (!note || note.deletedAt !== null) return this.send(res, 404, { error: "NOTE_NOT_FOUND" });
      const id = this.repos.tasks.create({
        noteId: note.id,
        title,
        dueAt: body.dueAt === undefined ? null : body.dueAt as number | null,
        reminderAt: null,
        recurrence: "none",
        priority: body.priority as "low" | "normal" | "high" | undefined,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      this.onChange();
      this.send(res, 201, { id, noteId: note.id, title });
    } catch (error) { this.jsonError(res, error); }
  }

  private async openNote(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const value = await this.readJson(req);
      if (!value || typeof value !== "object" || Array.isArray(value)) return this.send(res, 400, { error: "INVALID_REQUEST" });
      const body = value as Record<string, unknown>;
      if (Object.keys(body).length !== 1 || typeof body.id !== "string" || !GUID.test(body.id)) return this.send(res, 400, { error: "INVALID_NOTE" });
      const note = this.repos.notes.get(body.id);
      if (!note || note.deletedAt !== null) return this.send(res, 404, { error: "NOTE_NOT_FOUND" });
      await this.onOpenNote(note.id);
      this.send(res, 200, { opened: true, id: note.id });
    } catch (error) { this.jsonError(res, error); }
  }
}

