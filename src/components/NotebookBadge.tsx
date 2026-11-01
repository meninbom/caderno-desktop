import type { CSSProperties } from "react";
import {
  Book, Briefcase, Camera, Code, Dumbbell, FlaskConical, Gamepad2, Globe, GraduationCap, Heart, House,
  Leaf, Lightbulb, Lock, Music, Palette, Plane, Rocket, ShoppingCart, Star, Utensils, Wallet,
  type LucideIcon,
} from "lucide-react";
import type { Notebook } from "../../shared/ipc";
import { NOTEBOOK_DEFAULT_ICON, parseNotebookIcon, readableInk, type NotebookIconPreset } from "../../shared/notebook-customization";
import "../notebook-customization.css";

/** Ícones disponíveis para cadernos (a lista de nomes vive em shared/notebook-customization). */
export const NOTEBOOK_ICON_COMPONENTS: Record<NotebookIconPreset, { Icon: LucideIcon; label: string }> = {
  book: { Icon: Book, label: "Caderno" },
  briefcase: { Icon: Briefcase, label: "Trabalho" },
  home: { Icon: House, label: "Casa" },
  "graduation-cap": { Icon: GraduationCap, label: "Estudos" },
  lightbulb: { Icon: Lightbulb, label: "Ideias" },
  code: { Icon: Code, label: "Código" },
  "flask-conical": { Icon: FlaskConical, label: "Pesquisa" },
  heart: { Icon: Heart, label: "Favoritos" },
  star: { Icon: Star, label: "Destaque" },
  music: { Icon: Music, label: "Música" },
  camera: { Icon: Camera, label: "Fotos" },
  plane: { Icon: Plane, label: "Viagens" },
  "shopping-cart": { Icon: ShoppingCart, label: "Compras" },
  wallet: { Icon: Wallet, label: "Finanças" },
  leaf: { Icon: Leaf, label: "Natureza" },
  rocket: { Icon: Rocket, label: "Projetos" },
  palette: { Icon: Palette, label: "Criação" },
  gamepad: { Icon: Gamepad2, label: "Jogos" },
  utensils: { Icon: Utensils, label: "Receitas" },
  dumbbell: { Icon: Dumbbell, label: "Saúde" },
  globe: { Icon: Globe, label: "Mundo" },
  lock: { Icon: Lock, label: "Privado" },
};

type BadgeStyle = CSSProperties & { "--nb-accent"?: string; "--nb-ink"?: string };

/**
 * Ícone do caderno sem moldura (emoji ou glifo lucide herdando a cor do contexto).
 * Decorativo: o nome do caderno sempre acompanha o ícone.
 */
export function NotebookIcon({ icon, size = 15 }: { icon?: string | null; size?: number }) {
  const parsed = parseNotebookIcon(icon ?? NOTEBOOK_DEFAULT_ICON);
  if (parsed.kind === "emoji") return <span className="nb-emoji" aria-hidden="true" style={{ fontSize: Math.round(size * 0.9), width: size, height: size }}>{parsed.value}</span>;
  const { Icon } = NOTEBOOK_ICON_COMPONENTS[parsed.name];
  return <Icon size={size} aria-hidden="true" />;
}

/**
 * Selo do caderno para a barra lateral, listas e cabeçalhos.
 * - Padrão (ícone "book" sem cor): idêntico ao ícone antigo, sem moldura.
 * - Com cor: fundo na cor de destaque e tinta preta/branca escolhida por contraste (WCAG),
 *   portanto legível em qualquer tema e em qualquer cor escolhida.
 */
export function NotebookBadge({ notebook, icon, color, size = 15 }: { notebook?: Pick<Notebook, "icon" | "color">; icon?: string | null; color?: string | null; size?: number }) {
  const resolvedIcon = notebook?.icon ?? icon ?? NOTEBOOK_DEFAULT_ICON;
  const accent = notebook ? notebook.color : color ?? null;
  if (!accent) return <NotebookIcon icon={resolvedIcon} size={size} />;
  const frame = size + 3;
  const style: BadgeStyle = { "--nb-accent": accent, "--nb-ink": readableInk(accent), width: frame, height: frame };
  return <span className="nb-badge" data-accent="true" style={style}><NotebookIcon icon={resolvedIcon} size={Math.max(8, size - 3)} /></span>;
}

/** Acento CSS (#rrggbb) para estilizar uma linha; undefined quando não há cor. */
export function notebookAccentStyle(color: string | null | undefined): BadgeStyle | undefined {
  return color ? { "--nb-accent": color } : undefined;
}
