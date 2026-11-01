import { describe, expect, it } from 'vitest';
import {
  HOME_LAYOUT_KEY, HOME_WIDGETS, activeSources, defaultHomeLayout, hiddenWidgets, isDefaultLayout, moveWidget, moveWidgetTo, normalizeHomeLayout,
  parseHomeLayout, readHomeLayout, serializeHomeLayout, setWidgetEnabled, setWidgetSize, visibleWidgets, widgetRowLimit, writeHomeLayout,
  type HomeLayout, type HomeWidgetId,
} from '../shared/home-widgets';

const ids = (layout: HomeLayout) => layout.widgets.map(widget => widget.id);
const visibleIds = (layout: HomeLayout) => visibleWidgets(layout).map(widget => widget.id);
// Painel salvo na 0.16: as preferências anteriores continuam válidas depois do novo padrão.
const previousLayout = () => normalizeHomeLayout({ version: 1, widgets: [
  { id: 'recent', enabled: true, size: 'wide' },
  ...(['tasks', 'events', 'starred'] as const).map(id => ({ id, enabled: true, size: 'compact' })),
  ...(['notebooks', 'clock', 'summary'] as const).map(id => ({ id, enabled: false, size: 'compact' })),
] });
const memoryStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, data };
};

describe('layout padrão', () => {
  it('começa com dois cartões compactos, na ordem da referência', () => {
    const layout = defaultHomeLayout();
    expect(ids(layout)).toEqual(HOME_WIDGETS.map(widget => widget.id));
    expect(visibleIds(layout)).toEqual(['clock', 'recent']);
    expect(hiddenWidgets(layout).map(widget => widget.id)).toEqual(['tasks', 'events', 'starred', 'notebooks', 'summary']);
    expect(layout.widgets.every(widget => widget.size === 'compact')).toBe(true);
    expect(isDefaultLayout(layout)).toBe(true);
  });
  it('mantém ordem, visibilidade e tamanhos dos painéis existentes', () => {
    const layout = previousLayout();
    expect(visibleIds(layout)).toEqual(['recent', 'tasks', 'events', 'starred']);
    expect(layout.widgets.find(widget => widget.id === 'recent')?.size).toBe('wide');
    expect(readHomeLayout(memoryStorage({ [HOME_LAYOUT_KEY]: serializeHomeLayout(layout) }))).toEqual(layout);
  });
  it('listas têm limite de linhas por tamanho', () => {
    expect(widgetRowLimit('recent', 'compact')).toBeLessThan(widgetRowLimit('recent', 'wide'));
    for (const definition of HOME_WIDGETS) expect(definition.rows.wide).toBeGreaterThanOrEqual(definition.rows.compact);
  });
});

describe('normalização de dados salvos', () => {
  it('lixo, tipos errados e versões inválidas voltam ao padrão', () => {
    for (const raw of [null, undefined, 'x', 7, [], {}, { version: 1 }, { version: 1, widgets: 'recent' }, { version: 0, widgets: [{ id: 'recent' }] }, { version: '1', widgets: [{ id: 'recent' }] }, { version: NaN, widgets: [{ id: 'recent' }] }, { version: 1, widgets: [] }, { version: 1, widgets: [null, 3, 'a', { id: 'nope' }] }]) {
      expect(normalizeHomeLayout(raw)).toEqual(defaultHomeLayout());
    }
  });
  it('descarta ids desconhecidos e duplicados (o primeiro vence) e completa os ausentes desligados no fim', () => {
    const layout = normalizeHomeLayout({ version: 1, widgets: [
      { id: 'tasks', enabled: true, size: 'wide' }, { id: 'ghost', enabled: true }, { id: 'tasks', enabled: false, size: 'compact' }, { id: 'clock', enabled: true, size: 'compact' },
    ] });
    expect(ids(layout).slice(0, 2)).toEqual(['tasks', 'clock']);
    expect(new Set(ids(layout)).size).toBe(HOME_WIDGETS.length);
    expect(layout.widgets[0]).toEqual({ id: 'tasks', enabled: true, size: 'wide' });
    expect(layout.widgets.slice(2).every(widget => !widget.enabled)).toBe(true);
  });
  it('enabled e size inválidos usam o padrão do widget', () => {
    const layout = normalizeHomeLayout({ version: 1, widgets: [{ id: 'recent', enabled: 'yes', size: 'huge' }, { id: 'clock', enabled: 1, size: 3 }] });
    expect(layout.widgets[0]).toEqual({ id: 'recent', enabled: true, size: 'compact' });
    expect(layout.widgets[1]).toEqual({ id: 'clock', enabled: true, size: 'compact' });
  });
  it('versão futura é lida só pelo que reconhecemos e regravada na versão atual', () => {
    const layout = normalizeHomeLayout({ version: 9, widgets: [{ id: 'summary', enabled: true, size: 'compact', color: 'red' }, { id: 'newer-widget', enabled: true }], extra: true });
    expect(layout.version).toBe(1);
    expect(layout.widgets[0]).toEqual({ id: 'summary', enabled: true, size: 'compact' });
    expect(ids(layout)).not.toContain('newer-widget' as HomeWidgetId);
  });
  it('limita o volume de entradas lidas', () => {
    const many = Array.from({ length: 5000 }, () => ({ id: 'ghost' }));
    expect(normalizeHomeLayout({ version: 1, widgets: [...many, { id: 'recent' }] })).toEqual(defaultHomeLayout());
  });
});

describe('ordenação', () => {
  it('move para antes/depois trocando com o vizinho visível e ignorando ocultos', () => {
    let layout = previousLayout();
    layout = moveWidget(layout, 'tasks', 1);
    expect(visibleIds(layout)).toEqual(['recent', 'events', 'tasks', 'starred']);
    layout = moveWidget(layout, 'tasks', 1);
    expect(visibleIds(layout)).toEqual(['recent', 'events', 'starred', 'tasks']);
    // ocultos entre os visíveis não "gastam" um toque
    const hiddenBetween = normalizeHomeLayout({ version: 1, widgets: [{ id: 'recent', enabled: true }, { id: 'clock', enabled: false }, { id: 'summary', enabled: false }, { id: 'tasks', enabled: true }] });
    expect(visibleIds(moveWidget(hiddenBetween, 'recent', 1))).toEqual(['tasks', 'recent']);
    expect(visibleIds(moveWidget(hiddenBetween, 'tasks', -1))).toEqual(['tasks', 'recent']);
  });
  it('nos extremos, em widgets ocultos e ids desconhecidos devolve o mesmo objeto', () => {
    const layout = previousLayout();
    expect(moveWidget(layout, 'recent', -1)).toBe(layout);
    expect(moveWidget(layout, 'starred', 1)).toBe(layout);
    expect(moveWidget(layout, 'clock', 1)).toBe(layout);
    expect(moveWidget(layout, 'ghost' as HomeWidgetId, 1)).toBe(layout);
  });
  it('não muta o layout original', () => {
    const layout = previousLayout(), snapshot = JSON.stringify(layout);
    moveWidget(layout, 'tasks', 1); setWidgetEnabled(layout, 'clock', true); setWidgetSize(layout, 'tasks', 'wide'); moveWidgetTo(layout, 'recent', 'starred', 'after');
    expect(JSON.stringify(layout)).toBe(snapshot);
  });
  it('arrastar: coloca antes/depois do alvo; mesma posição é no-op', () => {
    const layout = previousLayout();
    expect(visibleIds(moveWidgetTo(layout, 'starred', 'recent', 'before'))).toEqual(['starred', 'recent', 'tasks', 'events']);
    expect(visibleIds(moveWidgetTo(layout, 'recent', 'events', 'after'))).toEqual(['tasks', 'events', 'recent', 'starred']);
    expect(moveWidgetTo(layout, 'recent', 'recent', 'after')).toBe(layout);
    expect(moveWidgetTo(layout, 'recent', 'tasks', 'before')).toBe(layout);
    expect(moveWidgetTo(layout, 'ghost' as HomeWidgetId, 'tasks', 'before')).toBe(layout);
  });
});

describe('mostrar, ocultar e tamanho', () => {
  it('adicionar leva o widget ao fim da área visível; ocultar preserva a ordem dos demais', () => {
    let layout = setWidgetEnabled(previousLayout(), 'summary', true);
    expect(visibleIds(layout)).toEqual(['recent', 'tasks', 'events', 'starred', 'summary']);
    layout = setWidgetEnabled(layout, 'clock', true);
    expect(visibleIds(layout)).toEqual(['recent', 'tasks', 'events', 'starred', 'summary', 'clock']);
    layout = setWidgetEnabled(layout, 'tasks', false);
    expect(visibleIds(layout)).toEqual(['recent', 'events', 'starred', 'summary', 'clock']);
    expect(ids(layout)).toHaveLength(HOME_WIDGETS.length);
    expect(setWidgetEnabled(layout, 'tasks', false)).toBe(layout);
  });
  it('reativar um widget oculto não duplica nem perde o tamanho escolhido', () => {
    let layout = setWidgetSize(defaultHomeLayout(), 'events', 'wide');
    layout = setWidgetEnabled(setWidgetEnabled(layout, 'events', false), 'events', true);
    expect(layout.widgets.filter(widget => widget.id === 'events')).toEqual([{ id: 'events', enabled: true, size: 'wide' }]);
  });
  it('tamanho aceita só valores do catálogo; repetir é no-op', () => {
    const layout = defaultHomeLayout();
    expect(setWidgetSize(layout, 'tasks', 'wide').widgets.find(widget => widget.id === 'tasks')?.size).toBe('wide');
    expect(setWidgetSize(layout, 'tasks', 'compact')).toBe(layout);
    expect(setWidgetSize(layout, 'tasks', 'huge' as never)).toBe(layout);
  });
  it('restaurar padrão = layout padrão novo e é detectável', () => {
    const changed = moveWidget(defaultHomeLayout(), 'recent', -1);
    expect(isDefaultLayout(changed)).toBe(false);
    expect(isDefaultLayout(defaultHomeLayout())).toBe(true);
  });
});

describe('fontes de dados ativas', () => {
  it('só pede dados dos widgets visíveis', () => {
    expect([...activeSources(defaultHomeLayout())]).toEqual(['notes']);
    expect([...activeSources(previousLayout())].sort()).toEqual(['events', 'notes', 'tasks']);
    let layout = previousLayout();
    for (const id of ['tasks', 'events'] as const) layout = setWidgetEnabled(layout, id, false);
    expect([...activeSources(layout)]).toEqual(['notes']);
    for (const id of ['recent', 'starred'] as const) layout = setWidgetEnabled(layout, id, false);
    expect(activeSources(layout).size).toBe(0);
    expect([...activeSources(setWidgetEnabled(layout, 'clock', true))]).toEqual([]);
  });
});

describe('persistência versionada', () => {
  it('serializa só configuração (id, enabled, size) com versão', () => {
    const parsed = JSON.parse(serializeHomeLayout(setWidgetEnabled(defaultHomeLayout(), 'clock', true)));
    expect(parsed.version).toBe(1);
    expect(Object.keys(parsed).sort()).toEqual(['version', 'widgets']);
    for (const widget of parsed.widgets) expect(Object.keys(widget).sort()).toEqual(['enabled', 'id', 'size']);
  });
  it('grava e reabre o mesmo layout (ida e volta)', () => {
    const storage = memoryStorage();
    const layout = setWidgetSize(moveWidget(setWidgetEnabled(defaultHomeLayout(), 'notebooks', true), 'events', -1), 'starred', 'wide');
    expect(writeHomeLayout(storage, layout)).toBe(true);
    expect(storage.data.has(HOME_LAYOUT_KEY)).toBe(true);
    expect(readHomeLayout(storage)).toEqual(layout);
  });
  it('armazenamento ausente, vazio, corrompido ou que lança → padrão, sem exceção', () => {
    expect(readHomeLayout(null)).toEqual(defaultHomeLayout());
    expect(readHomeLayout(memoryStorage())).toEqual(defaultHomeLayout());
    expect(readHomeLayout(memoryStorage({ [HOME_LAYOUT_KEY]: '{oops' }))).toEqual(defaultHomeLayout());
    expect(readHomeLayout({ getItem: () => { throw new Error('bloqueado'); } })).toEqual(defaultHomeLayout());
    expect(parseHomeLayout('null')).toEqual(defaultHomeLayout());
  });
  it('gravação recusada (cheio/indisponível) devolve false', () => {
    expect(writeHomeLayout({ setItem: () => { throw new Error('QuotaExceededError'); } }, defaultHomeLayout())).toBe(false);
    expect(writeHomeLayout(null, defaultHomeLayout())).toBe(false);
  });
});
