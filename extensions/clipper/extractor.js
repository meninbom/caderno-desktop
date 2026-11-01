/* Extrator local da página. Não altera o DOM original. Não é o Mozilla Readability.
   Tudo fica dentro de extractClip para o chrome.scripting.executeScript serializar a função. */
function extractClip(mode) {
  const MAX_CHARS = 600000;
  function textOf(node) {
    return (node.textContent || "").replace(/\s+/g, " ").trim();
  }
  function stripComments(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
    const found = [];
    while (walker.nextNode()) found.push(walker.currentNode);
    for (const node of found) node.parentNode.removeChild(node);
  }
  function resolveLinks(root) {
    root.querySelectorAll("a[href]").forEach(anchor => {
      const raw = anchor.getAttribute("href") || "";
      if (!raw || /^javascript:/i.test(raw) || /^data:/i.test(raw) || /^vbscript:/i.test(raw)) {
        anchor.removeAttribute("href");
        return;
      }
      try {
        const absolute = new URL(raw, location.href);
        if (absolute.protocol === "http:" || absolute.protocol === "https:" || absolute.protocol === "mailto:") anchor.setAttribute("href", absolute.href);
        else anchor.removeAttribute("href");
      } catch { anchor.removeAttribute("href"); }
    });
  }
  function clean(root) {
    const clone = root.cloneNode(true);
    clone.querySelectorAll("script,style,noscript,form,iframe,frame,object,embed,svg,canvas,video,audio,button,input,textarea,select,template,dialog,nav,footer,aside,[role='navigation'],[role='banner'],[role='contentinfo'],[role='complementary'],[role='dialog'],[hidden]").forEach(node => node.remove());
    clone.querySelectorAll("img[alt],img").forEach(img => {
      const alt = (img.getAttribute("alt") || "").trim();
      img.replaceWith(document.createTextNode(alt ? ` ${alt} ` : ""));
    });
    stripComments(clone);
    clone.querySelectorAll("*").forEach(node => {
      for (const attr of [...node.attributes]) {
        const name = attr.name.toLowerCase();
        if (name.startsWith("on") || ["src", "srcset", "style", "class", "id", "srcdoc", "formaction", "ping"].includes(name)) node.removeAttribute(attr.name);
      }
    });
    resolveLinks(clone);
    return clone;
  }
  function linkDensity(node) {
    const total = textOf(node).length || 1;
    let linked = 0;
    node.querySelectorAll("a").forEach(anchor => { linked += textOf(anchor).length; });
    return linked / total;
  }
  function score(node) {
    const length = textOf(node).length;
    let value = length;
    const tag = node.tagName ? node.tagName.toLowerCase() : "";
    if (tag === "article") value += 200;
    if (tag === "main" || node.getAttribute?.("role") === "main") value += 120;
    if (linkDensity(node) > 0.5) value *= 0.35;
    value += Math.min(node.querySelectorAll("p").length, 12) * 40;
    if (node.querySelector("table, pre, code, ul, ol")) value += 80;
    return value;
  }
  function sourceMeta() {
    const published = [
      ["meta[property='article:published_time']", "publicação"],
      ["meta[property='og:published_time']", "publicação"],
      ["meta[name='pubdate']", "publicação"],
      ["meta[name='date']", "publicação"],
      ["meta[name='dc.date']", "publicação"],
      ["meta[itemprop='datePublished']", "publicação"],
    ];
    for (const [selector, kind] of published) {
      const value = document.querySelector(selector)?.getAttribute("content");
      if (value && value.trim()) return { value: value.trim().slice(0, 80), kind };
    }
    const time = document.querySelector("time[datetime]")?.getAttribute("datetime");
    if (time && time.trim()) return { value: time.trim().slice(0, 80), kind: "data do elemento time" };
    for (const node of document.querySelectorAll("script[type='application/ld+json']")) {
      try {
        const data = JSON.parse(node.textContent || "null");
        const items = Array.isArray(data) ? data : [data, ...(Array.isArray(data?.["@graph"]) ? data["@graph"] : [])];
        for (const item of items) {
          const value = item && (item.datePublished || item.dateCreated);
          if (typeof value === "string" && value.trim()) return { value: value.trim().slice(0, 80), kind: "publicação" };
        }
      } catch { /* JSON-LD inválido não é data */ }
    }
    return { value: (document.lastModified || "").slice(0, 80), kind: "modificação do arquivo" };
  }
  function author() {
    return (document.querySelector("meta[name='author']")?.getAttribute("content")
      || document.querySelector("meta[property='article:author']")?.getAttribute("content")
      || "").trim().slice(0, 200);
  }
  function description() {
    return (document.querySelector("meta[name='description']")?.getAttribute("content")
      || document.querySelector("meta[property='og:description']")?.getAttribute("content")
      || "").trim().slice(0, 500);
  }
  function pack(root, quality, qualityReason) {
    const safe = clean(root);
    const text = textOf(safe);
    const html = safe.innerHTML || "";
    if (text.length > MAX_CHARS || html.length > MAX_CHARS) return { error: "CONTENT_TOO_LARGE" };
    const date = sourceMeta();
    return {
      title: (document.title || "").slice(0, 300),
      sourceURL: location.href,
      sourceDate: date.value,
      sourceDateKind: date.kind,
      author: author(),
      text,
      html,
      quality,
      qualityReason,
    };
  }
  if ((document.body?.textContent || "").length > 1200000) return { error: "CONTENT_TOO_LARGE" };
  if (mode === "selection") {
    const selection = getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return { error: "SELECTION_EMPTY" };
    const box = document.createElement("div");
    for (let index = 0; index < selection.rangeCount; index += 1) box.appendChild(selection.getRangeAt(index).cloneContents());
    if (!textOf(box)) return { error: "SELECTION_EMPTY" };
    return pack(box, "good", "Seleção da página, com a formatação disponível.");
  }
  if (mode === "bookmark") {
    const summary = description();
    const date = sourceMeta();
    const escaped = summary.replace(/[&<>]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char]));
    return {
      title: (document.title || "").slice(0, 300),
      sourceURL: location.href,
      sourceDate: date.value,
      sourceDateKind: date.kind,
      author: author(),
      text: summary,
      html: summary ? `<p>${escaped}</p>` : "",
      quality: "good",
      qualityReason: "Favorito: endereço, título e resumo, sem o corpo da página.",
    };
  }
  const copy = document.body.cloneNode(true);
  copy.querySelectorAll("script,style,noscript,form,iframe,frame,object,embed,svg,canvas,video,audio,button,input,textarea,select,template,dialog,nav,footer,aside,[role='navigation'],[role='banner'],[role='contentinfo'],[role='complementary'],[role='dialog'],[hidden]").forEach(node => node.remove());
  copy.querySelectorAll(":scope > header").forEach(node => node.remove());
  if (mode === "page") return pack(copy, "page", "Página sem os menus e rodapés mais óbvios.");
  const semantic = [...copy.querySelectorAll("article, main, [role='main']")];
  let blocks = [...copy.querySelectorAll("section, div")].filter(node => textOf(node).length > 200);
  if (blocks.length > 250) blocks = blocks.filter(node => node.querySelector("p, li, pre, table, h1, h2"));
  if (blocks.length > 250) blocks = blocks.slice(0, 250);
  let best = null;
  let bestScore = 0;
  for (const node of [...new Set([...semantic, ...blocks])]) {
    const value = score(node);
    if (value > bestScore) { best = node; bestScore = value; }
  }
  const bodyScore = score(copy);
  if (!best || bestScore < 80 || bestScore < bodyScore * 0.25) return pack(copy, "fallback", "Nenhum artigo destacado; a página limpa foi usada.");
  const ratio = textOf(best).length / Math.max(1, textOf(copy).length);
  const fair = ratio <= 0.15 || linkDensity(best) >= 0.45;
  return pack(best, fair ? "fair" : "good", fair ? "O trecho principal é curto ou tem muitos links." : "Trecho principal identificado.");
}
globalThis.extractClip = extractClip;
