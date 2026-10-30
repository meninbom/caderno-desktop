import { useCallback, useEffect, useState } from "react";

export interface Appearance {
  accent: string | null;
  editorFont: "sans" | "serif" | "mono";
  editorSize: number;
  lineHeight: number;
  paragraphGap: number;
  contentWidth: number;
  fullWidth: boolean;
  editorGutter: number;
  sidebarWidth: number;
  listWidth: number;
  floatingToolbar: boolean;
  spellcheck: boolean;
  sidebarCollapsed: boolean;
  listCollapsed: boolean;
}

export const DEFAULT_APPEARANCE: Appearance = {
  accent: null,
  editorFont: "sans",
  editorSize: 15.5,
  lineHeight: 1.7,
  paragraphGap: 0.65,
  contentWidth: 900,
  fullWidth: false,
  editorGutter: 32,
  sidebarWidth: 224,
  listWidth: 280,
  floatingToolbar: true,
  spellcheck: true,
  sidebarCollapsed: false,
  listCollapsed: false,
};

export const ACCENT_PRESETS: { name: string; value: string | null }[] = [
  { name: "Azul (padrão)", value: null },
  { name: "Índigo", value: "#6366f1" },
  { name: "Violeta", value: "#8b5cf6" },
  { name: "Rosa", value: "#db2777" },
  { name: "Vermelho", value: "#dc2626" },
  { name: "Laranja", value: "#ea580c" },
  { name: "Verde", value: "#16a34a" },
  { name: "Turquesa", value: "#0d9488" },
  { name: "Grafite", value: "#52525b" },
];

const KEY = "caderno.appearance.v1";
const FONTS = { sans: "var(--font-sans)", serif: 'Georgia, "Iowan Old Style", "Times New Roman", serif', mono: "var(--font-mono)" };

function clamp(v: unknown, min: number, max: number, fallback: number) {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

function load(): Appearance {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Appearance>;
    const d = DEFAULT_APPEARANCE;
    return {
      accent: typeof raw.accent === "string" && /^#[0-9a-f]{6}$/i.test(raw.accent) ? raw.accent : null,
      editorFont: raw.editorFont === "serif" || raw.editorFont === "mono" ? raw.editorFont : "sans",
      editorSize: clamp(raw.editorSize, 13, 22, d.editorSize),
      lineHeight: clamp(raw.lineHeight, 1.3, 2.2, d.lineHeight),
      paragraphGap: clamp(raw.paragraphGap, 0, 1.5, d.paragraphGap),
      contentWidth: clamp(raw.contentWidth, 320, 2400, d.contentWidth),
      fullWidth: raw.fullWidth === true,
      editorGutter: clamp(raw.editorGutter, 12, 160, d.editorGutter),
      sidebarWidth: clamp(raw.sidebarWidth, 190, 320, d.sidebarWidth),
      listWidth: clamp(raw.listWidth, 230, 420, d.listWidth),
      floatingToolbar: raw.floatingToolbar !== false,
      spellcheck: raw.spellcheck !== false,
      sidebarCollapsed: raw.sidebarCollapsed === true,
      listCollapsed: raw.listCollapsed === true,
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

function apply(a: Appearance) {
  const root = document.documentElement;
  const s = root.style;
  const set = (name: string, value: string | null) => (value === null ? s.removeProperty(name) : s.setProperty(name, value));
  set("--accent", a.accent);
  set("--accent-hover", a.accent && `color-mix(in srgb, ${a.accent} 82%, black)`);
  set("--accent-soft", a.accent && `color-mix(in srgb, ${a.accent} 11%, var(--bg))`);
  set("--accent-soft-strong", a.accent && `color-mix(in srgb, ${a.accent} 20%, var(--bg))`);
  s.setProperty("--editor-font", FONTS[a.editorFont]);
  s.setProperty("--editor-size", `${a.editorSize}px`);
  s.setProperty("--editor-line", String(a.lineHeight));
  s.setProperty("--editor-gap", `${a.paragraphGap}em`);
  s.setProperty("--editor-width", a.fullWidth ? "none" : `${a.contentWidth + a.editorGutter * 2}px`);
  s.setProperty("--editor-gutter", `${a.editorGutter}px`);
  s.setProperty("--sidebar-w", `${a.sidebarWidth}px`);
  s.setProperty("--list-w", `${a.listWidth}px`);
  root.toggleAttribute("data-toolbar-hidden", !a.floatingToolbar);
  root.toggleAttribute("data-no-spellcheck", !a.spellcheck);
  root.toggleAttribute("data-sidebar-collapsed", a.sidebarCollapsed);
  root.toggleAttribute("data-list-collapsed", a.listCollapsed);
  document.querySelectorAll(".ProseMirror, .title-input").forEach((el) => el.setAttribute("spellcheck", String(a.spellcheck)));
}

export function useAppearance() {
  const [appearance, setAppearance] = useState<Appearance>(load);
  useEffect(() => {
    apply(appearance);
    try { localStorage.setItem(KEY, JSON.stringify(appearance)); } catch { /* armazenamento indisponível */ }
  }, [appearance]);
  const update = useCallback((patch: Partial<Appearance>) => setAppearance((a) => ({ ...a, ...patch })), []);
  const reset = useCallback(() => setAppearance(DEFAULT_APPEARANCE), []);
  return { appearance, update, reset };
}
