const API = "http://127.0.0.1:43187/v1";
const $ = id => document.getElementById(id);
let activeTab;
const say = (text, bad = false) => { $("message").textContent = text; $("message").style.color = bad ? "#9b2730" : "#176b43"; };
async function token() { return (await chrome.storage.local.get(["token"])).token || null; }
async function request(route, options = {}) {
  const t = await token();
  const r = await fetch(API + route, { ...options, headers: { ...(options.headers || {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) } });
  const data = await r.json(); if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`); return data;
}
async function init() {
  $("save").disabled = true;
  if (!(await token())) return;
  $("pair").hidden = true; $("capture").hidden = false;
  activeTab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  try {
    if (!activeTab?.url) throw new Error("Volte à página e abra o Clipper pelo ícone da extensão para autorizar a captura.");
    const u = new URL(activeTab.url); if (!/^https?:$/.test(u.protocol)) throw new Error("Abra uma página http ou https.");
    $("origin").textContent = u.hostname;
    // Chromium may omit Origin on extension GETs. A JSON POST includes it,
    // preserving the bridge's strict paired-origin validation.
    const result = await request("/destinations", {method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}); $("notebook").replaceChildren(new Option("Sem caderno", ""));
    for (const n of result.notebooks) $("notebook").add(new Option(n.name, String(n.id)));
    $("save").disabled = false;
  } catch (e) { say(`Não foi possível conectar: ${e.message}`, true); }
}
$("pairButton").addEventListener("click", async () => {
  try {
    const code = $("code").value.trim(), nonce = $("nonce").value.trim();
    if (!/^\d{6}$/.test(code) || !/^[a-f0-9]{48}$/.test(nonce)) throw new Error("Informe o código de seis dígitos e o código de conexão do app.");
    const r = await fetch(API + "/pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, nonce }) });
    const d = await r.json(); if (!r.ok) throw new Error(d.error || "Código inválido ou expirado.");
    await chrome.storage.local.set({ token: d.token }); await init();
  } catch (e) { say(e.message, true); }
});
$("save").addEventListener("click", async () => {
  try {
    $("save").disabled = true;
    const mode = document.querySelector('[name=mode]:checked').value;
    const [result] = await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, args: [mode], func: mode => {
      const clean = root => {
        const clone = root.cloneNode(true);
        clone.querySelectorAll('script,style,form,iframe,frame,object,embed,svg,canvas,video,audio,button,input,textarea,select,nav,footer,header,[hidden],[aria-hidden="true"]').forEach(n => n.remove());
        clone.querySelectorAll('*').forEach(n => { for (const a of [...n.attributes]) if (/^on/i.test(a.name) || ['src','srcset','style','class','id'].includes(a.name)) n.removeAttribute(a.name); });
        return clone;
      };
      let root;
      if (mode === 'selection') { const selected = getSelection()?.toString().trim(); if (!selected) return { error: 'Selecione um trecho da página antes de salvar.' }; root = document.createElement('div'); root.textContent = selected; }
      else if (mode === 'article') root = [...document.querySelectorAll('article,main,[role=main]')].sort((a,b) => b.innerText.length - a.innerText.length)[0] || document.body;
      else root = document.body;
      const safe = clean(root);
      return { title: document.title.slice(0,300), sourceURL: location.href, sourceDate: document.querySelector('time[datetime]')?.getAttribute('datetime') || document.lastModified, text: (safe.innerText || safe.textContent || '').slice(0,600000), html: safe.innerHTML.slice(0,600000) };
    } });
    const item = result.result; if (item?.error) throw new Error(item.error); if (!item?.text.trim()) throw new Error("Não há texto para salvar.");
    const saved = await request("/clip", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...item, requestId: crypto.randomUUID(), mode, notebookId: $("notebook").value ? Number($("notebook").value) : null }) });
    say(saved.duplicate ? "Esta página já está salva." : `Salvo: ${saved.title}`);
  } catch (e) { say(`Falha ao salvar: ${e.message}`, true); } finally { $("save").disabled = false; }
});
$("disconnect").addEventListener("click", async () => { await chrome.storage.local.remove("token"); $("capture").hidden = true; $("pair").hidden = false; say("Extensão desconectada."); });
void init();
