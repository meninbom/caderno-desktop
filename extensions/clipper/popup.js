const API = "http://127.0.0.1:43187/v1";
const MAX_CLIP_BYTES = 1000000;
const $ = id => document.getElementById(id);
const REASONS = {
  SELECTION_EMPTY: "Selecione um trecho da página antes de salvar.",
  CONTENT_TOO_LARGE: "O conteúdo passa de 1 MB. Selecione um trecho menor ou use Favorito.",
  EMPTY_CONTENT: "Não há texto para salvar.",
  INVALID_SOURCE_URL: "Só é possível salvar páginas http ou https, sem usuário e senha na URL.",
  COMMENT_TOO_LONG: "O comentário passa de 2000 caracteres.",
  INVALID_TAGS: "Use no máximo 8 etiquetas, cada uma com até 80 caracteres.",
  TOKEN_EXPIRED: "A conexão expirou. Gere outro código no Caderno e pareie de novo.",
  UNAUTHORIZED: "A conexão expirou ou foi revogada. Pareie a extensão de novo.",
  ORIGIN_NOT_PAIRED: "A conexão expirou ou foi revogada. Pareie a extensão de novo.",
  PAYLOAD_TOO_LARGE: "O conteúdo passa de 1 MB. Selecione um trecho menor ou use Favorito.",
  NOTEBOOK_NOT_FOUND: "O caderno escolhido não existe mais.",
  NOTE_NOT_FOUND: "A nota de destino não existe mais.",
  NOTE_TRASHED: "Essa nota está na lixeira. Escolha outra ou crie uma nota nova.",
  INVALID_CLIP: "O Caderno não aceitou esta captura. Atualize o app e a extensão juntos.",
};
let activeTab = null;
let notebooks = [];
let draft = null;
let requestId = null;
let chosenNoteId = "";
let titleEdited = false;

const say = (text, bad = false) => {
  $("message").textContent = text;
  $("message").dataset.state = text ? (bad ? "bad" : "ok") : "";
};
function explain(error) {
  const code = String(error?.message || error || "");
  if (REASONS[code]) return REASONS[code];
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return "O Caderno não respondeu a tempo. O rascunho foi mantido; use Salvar de novo.";
  if (/Failed to fetch|NetworkError|ECONNREFUSED/i.test(code)) return "O Caderno parece fechado ou a ponte local está desligada.";
  if (/Cannot access contents|cannot be scripted|extensions gallery|The extensions gallery cannot be scripted/i.test(code)) return "Esta página não permite captura. Abra uma página http ou https pelo ícone da extensão.";
  return code || "Não foi possível salvar.";
}
async function token() { return (await chrome.storage.local.get(["token"])).token || null; }
function payloadBytes(value) { return new TextEncoder().encode(JSON.stringify(value)).length; }
async function request(route, options = {}) {
  const t = await token();
  const response = await fetch(API + route, { ...options, signal: AbortSignal.timeout(8000), headers: { ...(options.headers || {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
function selectedMode() { return document.querySelector("[name=mode]:checked")?.value || "article"; }
function wantsAppend() { return document.querySelector("[name=destination]:checked")?.value === "append"; }
function renderNotebooks() {
  const filter = $("notebookFilter").value.trim().toLocaleLowerCase("pt-BR");
  const previous = $("notebook").value;
  const options = notebooks.filter(item => !filter || item.name.toLocaleLowerCase("pt-BR").includes(filter));
  $("notebook").replaceChildren(new Option("Sem caderno", ""));
  for (const item of options) $("notebook").add(new Option(item.name, String(item.id)));
  if ([...$("notebook").options].some(option => option.value === previous)) $("notebook").value = previous;
}
function summary(html) {
  const count = tag => (String(html || "").match(new RegExp(`<${tag}\\b`, "gi")) || []).length;
  const parts = [];
  const paragraphs = count("p");
  const tables = count("table");
  const lists = count("ul") + count("ol");
  const links = count("a");
  const code = count("pre");
  if (paragraphs) parts.push(`${paragraphs} parágrafo${paragraphs > 1 ? "s" : ""}`);
  if (tables) parts.push(`${tables} tabela${tables > 1 ? "s" : ""}`);
  if (lists) parts.push(`${lists} lista${lists > 1 ? "s" : ""}`);
  if (code) parts.push(`${code} bloco${code > 1 ? "s de código" : " de código"}`);
  if (links) parts.push(`${links} link${links > 1 ? "s" : ""}`);
  return parts.join(", ");
}
function showDraft(item) {
  draft = item;
  if (!titleEdited) $("title").value = item.title || "";
  const full = item.text || "";
  $("preview").textContent = full.length > 4000 ? `${full.slice(0, 4000)}…` : full;
  const structure = summary(item.html);
  const partial = full.length > 4000 ? " Prévia parcial do texto." : "";
  $("previewMeta").textContent = `${item.qualityReason || "Prévia pronta."}${structure ? ` ${structure}.` : ""}${partial}`;
}
async function pageUrl() {
  activeTab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!activeTab?.url || !activeTab.id) throw new Error("Volte à página e abra o Clipper pelo ícone da extensão para autorizar a captura.");
  const url = new URL(activeTab.url);
  if (!/^https?:$/.test(url.protocol)) throw new Error("Abra uma página http ou https.");
  return url;
}
async function extract(mode) {
  const [result] = await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, func: extractClip, args: [mode] });
  if (!result || result.result == null) throw new Error("Não foi possível ler esta página.");
  return result.result;
}
async function loadPreview() {
  const mode = selectedMode();
  const item = await extract(mode);
  if (item.error) throw new Error(item.error);
  showDraft(item);
}
async function remember(body) {
  try {
    if (payloadBytes(body) > 900000) return;
    await chrome.storage.local.set({ pendingClip: body });
  } catch { /* cota local cheia: o rascunho segue só nesta janela */ }
}
async function forgetPending() {
  requestId = null;
  await chrome.storage.local.remove("pendingClip");
  $("pending").hidden = true;
}
function notebookId() { return $("notebook").value ? Number($("notebook").value) : null; }
function tagList() {
  return $("tags").value.split(",").map(item => item.trim()).filter(Boolean).slice(0, 8);
}
function buildBody(item, id, confirmNew) {
  return {
    requestId: id,
    title: ($("title").value.trim() || item.title || "").slice(0, 300),
    text: item.text || "",
    html: item.html || "",
    sourceURL: item.sourceURL,
    sourceDate: item.sourceDate || "",
    sourceDateKind: item.sourceDateKind || "",
    author: item.author || "",
    comment: $("comment").value,
    tags: tagList(),
    mode: selectedMode(),
    notebookId: notebookId(),
    confirmNew: confirmNew === true,
    appendToNoteId: wantsAppend() ? chosenNoteId : null,
  };
}
async function save(options = {}) {
  $("save").disabled = true;
  $("duplicateActions").hidden = true;
  try {
    if (!options.body) await pageUrl();
    if (!options.body && wantsAppend() && !/^[a-f0-9-]{36}$/i.test(chosenNoteId)) throw new Error("Escolha a nota que deve receber o trecho.");
    const id = options.confirmNew || options.body ? (options.confirmNew ? crypto.randomUUID() : options.body.requestId) : (requestId ||= crypto.randomUUID());
    requestId = id;
    let body = options.body;
    if (!body) {
      const mode = selectedMode();
      const fresh = !draft || draft.mode !== mode ? await extract(mode) : draft;
      if (fresh.error) throw new Error(fresh.error);
      if (!fresh.text?.trim() && !fresh.html?.trim() && mode !== "bookmark") throw new Error("EMPTY_CONTENT");
      fresh.mode = mode;
      body = buildBody(fresh, id, options.confirmNew === true);
      if (!body.title.trim()) throw new Error("EMPTY_CONTENT");
    }
    if (payloadBytes(body) > MAX_CLIP_BYTES) throw new Error("CONTENT_TOO_LARGE");
    await remember(body);
    const saved = await request("/clip", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    await forgetPending();
    if (saved.duplicate) {
      say("Esta página já está salva.");
      $("duplicateActions").hidden = false;
      return;
    }
    if (saved.trashed) {
      say("Essa tentativa já foi salva e a nota está na lixeira.", true);
      return;
    }
    say(!options.body && wantsAppend() && !saved.idempotent ? `Acrescentado em: ${saved.title}` : `Salvo: ${saved.title}`);
    titleEdited = false;
  } catch (error) {
    say(explain(error), true);
    if (error?.message === "NOTEBOOK_NOT_FOUND") {
      try { const catalog = await request("/destinations", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); notebooks = catalog.notebooks || []; renderNotebooks(); } catch { /* a mensagem principal já explica */ }
    }
  } finally { $("save").disabled = false; }
}
async function init() {
  $("save").disabled = true;
  if (!(await token())) return;
  $("pair").hidden = true;
  $("capture").hidden = false;
  try {
    const commands = await chrome.commands.getAll();
    const action = commands.find(item => item.name === "_execute_action");
    $("shortcut").textContent = action?.shortcut ? `Atalho atribuído: ${action.shortcut}` : "Atalho ainda não atribuído. Abra pelo ícone ou defina um em chrome://extensions/shortcuts.";
  } catch { $("shortcut").textContent = ""; }
  try {
    const url = await pageUrl();
    $("origin").textContent = url.hostname;
    const catalog = await request("/destinations", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    notebooks = catalog.notebooks || [];
    renderNotebooks();
    const stored = await chrome.storage.local.get(["notebookId"]);
    if (stored.notebookId && [...$("notebook").options].some(option => option.value === stored.notebookId)) $("notebook").value = stored.notebookId;
    $("tagList").replaceChildren(...(catalog.tags || []).map(tag => { const option = document.createElement("option"); option.value = tag.name; return option; }));
    say("");
    $("save").disabled = false;
    const pending = await chrome.storage.local.get(["pendingClip"]);
    $("pending").hidden = !pending.pendingClip;
    void loadPreview().catch(error => { $("previewMeta").textContent = explain(error); });
  } catch (error) {
    say(explain(error), true);
    if (/TOKEN_EXPIRED|UNAUTHORIZED|ORIGIN_NOT_PAIRED/.test(String(error?.message))) {
      await chrome.storage.local.remove("token");
      $("capture").hidden = true;
      $("pair").hidden = false;
    }
  }
}
$("pairButton").addEventListener("click", async () => {
  try {
    const code = $("code").value.trim();
    const nonce = $("nonce").value.trim();
    if (!/^\d{6}$/.test(code) || !/^[a-f0-9]{48}$/.test(nonce)) throw new Error("Informe o código de seis dígitos e o código de conexão do app.");
    const response = await fetch(API + "/pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, nonce }), signal: AbortSignal.timeout(8000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Código inválido ou expirado.");
    await chrome.storage.local.set({ token: data.token });
    await init();
  } catch (error) { say(explain(error), true); }
});
$("code").addEventListener("keydown", event => { if (event.key === "Enter") $("pairButton").click(); });
$("nonce").addEventListener("keydown", event => { if (event.key === "Enter") $("pairButton").click(); });
$("title").addEventListener("input", () => { titleEdited = true; });
$("notebookFilter").addEventListener("input", renderNotebooks);
$("notebook").addEventListener("change", () => { void chrome.storage.local.set({ notebookId: $("notebook").value }); });
document.querySelectorAll("[name=mode]").forEach(input => input.addEventListener("change", () => { draft = null; titleEdited = false; void loadPreview().catch(error => { $("previewMeta").textContent = explain(error); }); }));
document.querySelectorAll("[name=destination]").forEach(input => input.addEventListener("change", () => { $("appendBox").hidden = !wantsAppend(); }));
let searchTimer = 0;
$("noteQuery").addEventListener("input", () => {
  chosenNoteId = "";
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(async () => {
    const query = $("noteQuery").value.trim();
    $("noteResults").replaceChildren();
    if (query.length < 2) return;
    try {
      const result = await request("/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
      for (const note of result.notes || []) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = `${note.title || "Sem título"} — ${note.notebook || "Sem caderno"}`;
        button.addEventListener("click", () => {
          chosenNoteId = note.id;
          for (const item of $("noteResults").children) item.setAttribute("aria-pressed", "false");
          button.setAttribute("aria-pressed", "true");
        });
        $("noteResults").append(button);
      }
      if (!(result.notes || []).length) $("noteResults").textContent = "Nenhuma nota com esse título.";
    } catch (error) { $("noteResults").textContent = explain(error); }
  }, 200);
});
$("refreshPreview").addEventListener("click", () => { draft = null; void loadPreview().catch(error => { $("previewMeta").textContent = explain(error); }); });
$("save").addEventListener("click", () => { void save(); });
$("saveAnyway").addEventListener("click", () => { void save({ confirmNew: true }); });
$("retryPending").addEventListener("click", async () => {
  const stored = await chrome.storage.local.get(["pendingClip"]);
  if (!stored.pendingClip) { $("pending").hidden = true; return; }
  await save({ body: stored.pendingClip });
});
$("discardPending").addEventListener("click", () => { void forgetPending(); say("Envio pendente descartado."); });
$("disconnect").addEventListener("click", async () => {
  await chrome.storage.local.remove(["token", "pendingClip"]);
  $("capture").hidden = true;
  $("pair").hidden = false;
  say("Extensão desconectada.");
});
void init();
