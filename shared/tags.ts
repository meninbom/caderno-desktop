export function normalizeTagName(name: string): string {
  return name.normalize("NFC").trim().replace(/\s+/g, " ");
}

export function tagKey(name: string): string {
  return normalizeTagName(name).toLocaleLowerCase("pt-BR");
}

export function tagSearchKey(name: string): string {
  return tagKey(name).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
