export interface SearchQuery {
  text: string;
  notebook?: string;
  tags: string[];
  before?: string;
  after?: string;
  type?: "note" | "attachment" | "transcription";
}

/** Parses the small, local search language. Values may be quoted; backslash escapes
 * the following character both inside and outside quotes. */
export function parseSearchQuery(input: string): SearchQuery {
  const tokens: string[] = [];
  let token = "", quoted = false, escaped = false;
  for (const char of input) {
    if (escaped) { token += char; escaped = false; continue; }
    if (char === "\\") { escaped = true; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (/\s/.test(char) && !quoted) { if (token) tokens.push(token); token = ""; continue; }
    token += char;
  }
  if (escaped) throw new Error("Busca inválida: escape sem caractere depois da barra.");
  if (quoted) throw new Error("Busca inválida: aspas sem fechamento.");
  if (token) tokens.push(token);
  const result: SearchQuery = { text: "", tags: [] }, words: string[] = [];
  for (const item of tokens) {
    const colon = item.indexOf(":");
    if (colon < 0) { words.push(item); continue; }
    const key = item.slice(0, colon).toLowerCase(), value = item.slice(colon + 1);
    if (!["notebook", "tag", "before", "after", "type"].includes(key)) { words.push(item); continue; }
    if (!value.trim()) throw new Error(`Busca inválida: informe um valor para ${key}:.`);
    if (key === "notebook") result.notebook = value;
    else if (key === "tag") result.tags.push(value);
    else if (key === "type") {
      if (!["note", "attachment", "transcription"].includes(value)) throw new Error("Tipo inválido. Use note, attachment ou transcription.");
      result.type = value as SearchQuery["type"];
    } else {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value)
        throw new Error(`Data inválida em ${key}: use AAAA-MM-DD.`);
      if (key === "before") result.before = value;
      else result.after = value;
    }
  }
  result.text = words.join(" ");
  return result;
}

export function toFtsExpression(text: string): string {
  // Treat user text as literal tokens, never as raw FTS5 syntax.
  const tokens = text.normalize("NFC").match(/[\p{L}\p{N}_]+/gu) ?? [];
  return tokens.map(t => `"${t.replace(/"/g, '""')}"`).join(" AND ");
}
