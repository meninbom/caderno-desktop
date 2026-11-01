/**
 * Layout (preferências) dos widgets da tela inicial. Puro e sem DOM: a normalização, as operações de
 * ordenação e a (de)serialização são testadas em Node. Só guarda *configuração* — nunca notas ou tarefas.
 */

export const HOME_LAYOUT_VERSION = 1;
export const HOME_LAYOUT_KEY = 'caderno.home.v1';

export type HomeWidgetId = 'recent' | 'starred' | 'tasks' | 'events' | 'notebooks' | 'clock' | 'summary';
export type HomeWidgetSize = 'compact' | 'wide';
/** Fontes de dados que um widget pode exigir; permite buscar apenas o que está visível. */
export type HomeDataSource = 'notes' | 'tasks' | 'events';

export interface HomeWidgetDefinition {
  id: HomeWidgetId;
  title: string;
  description: string;
  defaultSize: HomeWidgetSize;
  defaultEnabled: boolean;
  sizes: readonly HomeWidgetSize[];
  /** Linhas exibidas por tamanho; nenhuma lista cresce além disso. */
  rows: Record<HomeWidgetSize, number>;
  sources: readonly HomeDataSource[];
}

const BOTH = ['compact', 'wide'] as const;

/** Ordem do catálogo = ordem padrão do painel e das sugestões de "adicionar". */
export const HOME_WIDGETS: readonly HomeWidgetDefinition[] = [
  { id: 'clock', title: 'Tempo e clima', description: 'Relógio, data e clima da cidade escolhida.', defaultSize: 'compact', defaultEnabled: true, sizes: BOTH, rows: { compact: 0, wide: 0 }, sources: [] },
  { id: 'recent', title: 'Notas recentes', description: 'As últimas notas que você editou.', defaultSize: 'compact', defaultEnabled: true, sizes: BOTH, rows: { compact: 2, wide: 8 }, sources: ['notes'] },
  { id: 'tasks', title: 'Tarefas de hoje', description: 'Tarefas atrasadas e com prazo para hoje.', defaultSize: 'compact', defaultEnabled: false, sizes: BOTH, rows: { compact: 5, wide: 8 }, sources: ['tasks'] },
  { id: 'events', title: 'Próximos eventos', description: 'O que está na agenda nos próximos dias.', defaultSize: 'compact', defaultEnabled: false, sizes: BOTH, rows: { compact: 4, wide: 6 }, sources: ['events'] },
  { id: 'starred', title: 'Fixadas e favoritas', description: 'Notas fixadas e marcadas como favoritas.', defaultSize: 'compact', defaultEnabled: false, sizes: BOTH, rows: { compact: 5, wide: 8 }, sources: ['notes'] },
  { id: 'notebooks', title: 'Cadernos', description: 'Atalhos para os seus cadernos.', defaultSize: 'compact', defaultEnabled: false, sizes: BOTH, rows: { compact: 6, wide: 12 }, sources: [] },
  { id: 'summary', title: 'Resumo', description: 'Totais de notas, favoritas, cadernos e etiquetas.', defaultSize: 'compact', defaultEnabled: false, sizes: BOTH, rows: { compact: 0, wide: 0 }, sources: [] },
];

const BY_ID = new Map<string, HomeWidgetDefinition>(HOME_WIDGETS.map(definition => [definition.id, definition]));
export const getWidgetDefinition = (id: HomeWidgetId): HomeWidgetDefinition => BY_ID.get(id)!;
export const isHomeWidgetId = (value: unknown): value is HomeWidgetId => typeof value === 'string' && BY_ID.has(value);
export const isHomeWidgetSize = (value: unknown): value is HomeWidgetSize => value === 'compact' || value === 'wide';
export const widgetRowLimit = (id: HomeWidgetId, size: HomeWidgetSize): number => getWidgetDefinition(id).rows[size];

export interface HomeWidgetState { id: HomeWidgetId; enabled: boolean; size: HomeWidgetSize }
export interface HomeLayout { version: typeof HOME_LAYOUT_VERSION; widgets: HomeWidgetState[] }

export function defaultHomeLayout(): HomeLayout {
  return { version: HOME_LAYOUT_VERSION, widgets: HOME_WIDGETS.map(({ id, defaultEnabled, defaultSize }) => ({ id, enabled: defaultEnabled, size: defaultSize })) };
}

const MAX_STORED_ENTRIES = 64;

/**
 * Aceita qualquer valor vindo do armazenamento e devolve sempre um layout válido:
 *  - lixo, versão ausente/inválida/< 1 ou nenhuma entrada utilizável → padrão;
 *  - ids desconhecidos e duplicados são descartados (o primeiro vence);
 *  - `enabled`/`size` inválidos voltam ao padrão do widget;
 *  - widgets do catálogo que não constam no salvo (ex.: criados numa versão futura) entram no fim, desligados;
 *  - versões maiores que a atual são lidas só pelo que reconhecemos (não destrói dados de uma versão mais nova).
 */
export function normalizeHomeLayout(raw: unknown): HomeLayout {
  if (!raw || typeof raw !== 'object') return defaultHomeLayout();
  const { version, widgets } = raw as { version?: unknown; widgets?: unknown };
  if (typeof version !== 'number' || !Number.isFinite(version) || version < 1 || !Array.isArray(widgets)) return defaultHomeLayout();
  const seen = new Set<HomeWidgetId>(), result: HomeWidgetState[] = [];
  for (const entry of widgets.slice(0, MAX_STORED_ENTRIES)) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, enabled, size } = entry as { id?: unknown; enabled?: unknown; size?: unknown };
    if (!isHomeWidgetId(id) || seen.has(id)) continue;
    seen.add(id);
    const definition = getWidgetDefinition(id);
    result.push({
      id,
      enabled: typeof enabled === 'boolean' ? enabled : definition.defaultEnabled,
      size: isHomeWidgetSize(size) && definition.sizes.includes(size) ? size : definition.defaultSize,
    });
  }
  if (result.length === 0) return defaultHomeLayout();
  for (const definition of HOME_WIDGETS) if (!seen.has(definition.id)) result.push({ id: definition.id, enabled: false, size: definition.defaultSize });
  return { version: HOME_LAYOUT_VERSION, widgets: result };
}

export const visibleWidgets = (layout: HomeLayout): HomeWidgetState[] => layout.widgets.filter(widget => widget.enabled);
export const hiddenWidgets = (layout: HomeLayout): HomeWidgetState[] => layout.widgets.filter(widget => !widget.enabled);

/** Fontes de dados necessárias aos widgets visíveis: nada é buscado para widgets ocultos. */
export function activeSources(layout: HomeLayout): Set<HomeDataSource> {
  const sources = new Set<HomeDataSource>();
  for (const widget of layout.widgets) if (widget.enabled) for (const source of getWidgetDefinition(widget.id).sources) sources.add(source);
  return sources;
}

export function isDefaultLayout(layout: HomeLayout): boolean {
  const base = defaultHomeLayout().widgets;
  return layout.widgets.length === base.length && layout.widgets.every((widget, index) => widget.id === base[index].id && widget.enabled === base[index].enabled && widget.size === base[index].size);
}

const indexOfWidget = (layout: HomeLayout, id: HomeWidgetId) => layout.widgets.findIndex(widget => widget.id === id);

/**
 * Troca o widget com o vizinho *visível* na direção pedida (ocultos no caminho não contam, para que
 * cada toque mova algo na tela). Sem vizinho, ou id desconhecido/oculto, devolve o mesmo objeto.
 */
export function moveWidget(layout: HomeLayout, id: HomeWidgetId, direction: -1 | 1): HomeLayout {
  const from = indexOfWidget(layout, id);
  if (from < 0 || !layout.widgets[from].enabled) return layout;
  let to = from + direction;
  while (to >= 0 && to < layout.widgets.length && !layout.widgets[to].enabled) to += direction;
  if (to < 0 || to >= layout.widgets.length) return layout;
  const widgets = layout.widgets.slice();
  [widgets[from], widgets[to]] = [widgets[to], widgets[from]];
  return { ...layout, widgets };
}

/** Arrastar-e-soltar: coloca `id` imediatamente antes/depois de `targetId`. */
export function moveWidgetTo(layout: HomeLayout, id: HomeWidgetId, targetId: HomeWidgetId, placement: 'before' | 'after'): HomeLayout {
  if (id === targetId) return layout;
  const from = indexOfWidget(layout, id);
  if (from < 0 || indexOfWidget(layout, targetId) < 0) return layout;
  const widgets = layout.widgets.slice();
  const [moved] = widgets.splice(from, 1);
  const target = widgets.findIndex(widget => widget.id === targetId);
  widgets.splice(placement === 'before' ? target : target + 1, 0, moved);
  const unchanged = widgets.every((widget, index) => widget === layout.widgets[index]);
  return unchanged ? layout : { ...layout, widgets };
}

/** Ativar leva o widget para o fim da área visível; desativar preserva a posição relativa. */
export function setWidgetEnabled(layout: HomeLayout, id: HomeWidgetId, enabled: boolean): HomeLayout {
  const from = indexOfWidget(layout, id);
  if (from < 0 || layout.widgets[from].enabled === enabled) return layout;
  const widgets = layout.widgets.slice();
  if (!enabled) {
    widgets[from] = { ...widgets[from], enabled };
    return { ...layout, widgets };
  }
  const [moved] = widgets.splice(from, 1);
  let lastVisible = -1;
  widgets.forEach((widget, index) => { if (widget.enabled) lastVisible = index; });
  widgets.splice(lastVisible + 1, 0, { ...moved, enabled });
  return { ...layout, widgets };
}

export function setWidgetSize(layout: HomeLayout, id: HomeWidgetId, size: HomeWidgetSize): HomeLayout {
  const from = indexOfWidget(layout, id);
  if (from < 0 || layout.widgets[from].size === size || !getWidgetDefinition(id).sizes.includes(size)) return layout;
  const widgets = layout.widgets.slice();
  widgets[from] = { ...widgets[from], size };
  return { ...layout, widgets };
}

// ---- Persistência ----------------------------------------------------------------------------------

export type HomeStorageReader = Pick<Storage, 'getItem'>;
export type HomeStorageWriter = Pick<Storage, 'setItem'>;

export function parseHomeLayout(text: string | null | undefined): HomeLayout {
  if (!text) return defaultHomeLayout();
  try { return normalizeHomeLayout(JSON.parse(text)); } catch { return defaultHomeLayout(); }
}

export function serializeHomeLayout(layout: HomeLayout): string {
  return JSON.stringify({ version: HOME_LAYOUT_VERSION, widgets: layout.widgets.map(({ id, enabled, size }) => ({ id, enabled, size })) });
}

export function readHomeLayout(storage: HomeStorageReader | null | undefined): HomeLayout {
  try { return parseHomeLayout(storage?.getItem(HOME_LAYOUT_KEY)); } catch { return defaultHomeLayout(); }
}

/** `false` quando o armazenamento recusa a gravação (cheio/indisponível); o painel continua em memória. */
export function writeHomeLayout(storage: HomeStorageWriter | null | undefined, layout: HomeLayout): boolean {
  if (!storage) return false;
  try { storage.setItem(HOME_LAYOUT_KEY, serializeHomeLayout(layout)); return true; } catch { return false; }
}
