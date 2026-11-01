import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import {
  BookOpen, CalendarDays, ChevronLeft, ChevronRight, Clock, CloudSun, EyeOff, GripVertical, History, LayoutGrid, ListChecks, Maximize2, Minimize2,
  Plus, RotateCcw, Search, SlidersHorizontal, Star,
} from "lucide-react";
import { formatLongDate, greetingFor } from "../../shared/home-content";
import {
  activeSources, getWidgetDefinition, hiddenWidgets, isDefaultLayout, moveWidget, moveWidgetTo, visibleWidgets,
  type HomeLayout, type HomeWidgetId, type HomeWidgetState,
} from "../../shared/home-widgets";
import { useHomeData } from "../hooks/useHomeData";
import { useHomeLayout } from "../state/homeWidgets";
import { useAppStore } from "../state/store";
import {
  HomeClockBody, HomeEventsBody, HomeNotebooksBody, HomeRecentBody, HomeStarredBody, HomeSummaryBody, HomeTasksBody, type HomeActions,
} from "./HomeWidgetBodies";
import "../home-dashboard.css";

export interface HomeDashboardProps {
  /** Abre a pesquisa geral (Ctrl+K); `query` já preenche o campo quando o usuário digitou algo. */
  onSearch(query?: string): void;
  onNewNote(): void | Promise<void>;
  onNavigate(area: "tasks" | "calendar"): void;
  onOpenNote(id: string): void | Promise<void>;
  /** Opcional: por padrão seleciona o caderno no store (lista de notas). */
  onOpenNotebook?(id: number): void;
  /** Enquanto uma nota está abrindo: mostra "Abrindo nota…" sem esconder o painel. */
  opening?: boolean;
}

const ICONS: Record<HomeWidgetId, typeof Clock> = { recent: History, tasks: ListChecks, events: CalendarDays, starred: Star, notebooks: BookOpen, clock: CloudSun, summary: LayoutGrid };
const WIDGET_LINKS: Partial<Record<HomeWidgetId, { area: "tasks" | "calendar"; label: string }>> = { tasks: { area: "tasks", label: "Ver todas" }, events: { area: "calendar", label: "Abrir calendário" } };
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Hora corrente atualizada só quando a janela volta a ser vista (nada de temporizadores em repouso). */
function useNowOnFocus(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const refresh = () => { if (!document.hidden) setNow(Date.now()); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  return now;
}

const editable = (target: EventTarget | null) => !!(target as HTMLElement | null)?.closest?.('input:not([type="checkbox"]),textarea,select,[contenteditable="true"],[role="combobox"]');

interface FrameProps {
  widget: HomeWidgetState;
  index: number;
  count: number;
  editing: boolean;
  dragging: HomeWidgetId | null;
  dropMark: "before" | "after" | null;
  onMove(id: HomeWidgetId, direction: -1 | 1): void;
  onToggleSize(widget: HomeWidgetState): void;
  onHide(id: HomeWidgetId): void;
  onDragStart(id: HomeWidgetId, event: DragEvent<HTMLElement>): void;
  onDragOver(id: HomeWidgetId, event: DragEvent<HTMLElement>): void;
  onDrop(id: HomeWidgetId, event: DragEvent<HTMLElement>): void;
  onDragEnd(): void;
  onLink(area: "tasks" | "calendar"): void;
  children: ReactNode;
}

function HomeWidgetFrame({ widget, index, count, editing, dragging, dropMark, onMove, onToggleSize, onHide, onDragStart, onDragOver, onDrop, onDragEnd, onLink, children }: FrameProps) {
  const definition = getWidgetDefinition(widget.id), Icon = ICONS[widget.id], link = WIDGET_LINKS[widget.id];
  const titleId = `home-widget-${widget.id}-title`;
  return <section
    className="home-widget" data-widget-id={widget.id} data-size={widget.size} data-editing={editing || undefined}
    data-dragging={dragging === widget.id || undefined} data-drop={dropMark ?? undefined} aria-labelledby={titleId}
    onDragOver={editing ? event => onDragOver(widget.id, event) : undefined} onDrop={editing ? event => onDrop(widget.id, event) : undefined}
  >
    <header className="home-widget-head">
      <h2 id={titleId}><Icon size={14} aria-hidden="true" /> {definition.title}</h2>
      {editing ? <div className="home-widget-tools" role="group" aria-label={`Opções de ${definition.title}`}>
        <span className="home-grip" draggable title="Arraste para reordenar" aria-hidden="true" onDragStart={event => onDragStart(widget.id, event)} onDragEnd={onDragEnd}><GripVertical size={14} /></span>
        <button type="button" data-action="move-before" disabled={index === 0} title="Mover para antes" aria-label={`Mover ${definition.title} para antes`} onClick={() => onMove(widget.id, -1)}><ChevronLeft size={14} /></button>
        <button type="button" data-action="move-after" disabled={index === count - 1} title="Mover para depois" aria-label={`Mover ${definition.title} para depois`} onClick={() => onMove(widget.id, 1)}><ChevronRight size={14} /></button>
        <button type="button" data-action="size" title={widget.size === "wide" ? "Deixar compacto" : "Deixar largo"} aria-label={widget.size === "wide" ? `Deixar ${definition.title} compacto` : `Deixar ${definition.title} largo`} onClick={() => onToggleSize(widget)}>{widget.size === "wide" ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>
        <button type="button" data-action="hide" title="Ocultar do painel" aria-label={`Ocultar ${definition.title}`} onClick={() => onHide(widget.id)}><EyeOff size={14} /></button>
      </div> : link && <button type="button" className="home-link-button" onClick={() => onLink(link.area)}>{link.label}</button>}
    </header>
    {/* `inert`: durante a personalização o conteúdo é só pré-visualização e não recebe cliques nem foco. */}
    <div className="home-widget-body" inert={editing}>{children}</div>
  </section>;
}

export function HomeDashboard({ onSearch, onNewNote, onNavigate, onOpenNote, onOpenNotebook, opening = false }: HomeDashboardProps) {
  const { dispatch } = useAppStore();
  const { layout, saveError, move, moveTo, setEnabled, setSize, restore } = useHomeLayout();
  const now = useNowOnFocus();
  const [query, setQuery] = useState(""), [editing, setEditing] = useState(false), [busy, setBusy] = useState(false), [announcement, setAnnouncement] = useState("");
  const [undo, setUndo] = useState<HomeLayout | null>(null);
  const [drag, setDrag] = useState<{ id: HomeWidgetId; over: { id: HomeWidgetId; placement: "before" | "after" } | null } | null>(null);
  const root = useRef<HTMLElement>(null), input = useRef<HTMLInputElement>(null), opener = useRef<HTMLButtonElement>(null), panelTitle = useRef<HTMLHeadingElement>(null);
  const pendingFocus = useRef<{ id: HomeWidgetId; action: string; fallback?: string } | null>(null);

  const visible = useMemo(() => visibleWidgets(layout), [layout]);
  const hidden = useMemo(() => hiddenWidgets(layout), [layout]);
  const sources = useMemo(() => activeSources(layout), [layout]);
  const data = useHomeData({ notes: sources.has("notes"), tasks: sources.has("tasks"), events: sources.has("events") });

  const actions = useMemo<HomeActions>(() => ({
    openNote: id => void onOpenNote(id),
    navigate: area => onNavigate(area),
    openNotebook: id => onOpenNotebook ? onOpenNotebook(id) : dispatch({ type: "selection", selection: { kind: "notebook", notebookId: id } }),
  }), [onOpenNote, onNavigate, onOpenNotebook, dispatch]);

  // "/" foca a busca quando nada está sendo digitado e nenhum diálogo está aberto.
  useEffect(() => {
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "/" || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || editable(event.target) || document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      input.current?.focus();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);

  // Depois de reordenar/ocultar/adicionar o DOM é reaproveitado ou trocado: devolve o foco ao controle equivalente.
  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    const scope = root.current;
    const find = (action: string) => scope?.querySelector<HTMLElement>(`[data-widget-id="${target.id}"] [data-action="${action}"]:not(:disabled)`);
    (find(target.action) ?? (target.fallback ? find(target.fallback) : null) ?? scope?.querySelector<HTMLElement>(`[data-widget-id="${target.id}"]`))?.focus();
  }, [layout]);

  const announceIndex = (next: HomeLayout, id: HomeWidgetId) => {
    const list = visibleWidgets(next), position = list.findIndex(widget => widget.id === id) + 1;
    setAnnouncement(`${getWidgetDefinition(id).title}: posição ${position} de ${list.length}.`);
  };
  const handleMove = useCallback((id: HomeWidgetId, direction: -1 | 1) => {
    const next = moveWidget(layout, id, direction);
    if (next === layout) return;
    pendingFocus.current = { id, action: direction < 0 ? "move-before" : "move-after", fallback: direction < 0 ? "move-after" : "move-before" };
    move(id, direction);
    announceIndex(next, id);
  }, [layout, move]);
  const handleSize = (widget: HomeWidgetState) => {
    const size = widget.size === "wide" ? "compact" : "wide";
    pendingFocus.current = { id: widget.id, action: "size" };
    setSize(widget.id, size);
    setAnnouncement(`${getWidgetDefinition(widget.id).title}: tamanho ${size === "wide" ? "largo" : "compacto"}.`);
  };
  const handleHide = (id: HomeWidgetId) => {
    setEnabled(id, false);
    setAnnouncement(`${getWidgetDefinition(id).title} ocultado. Disponível para adicionar de novo.`);
    window.requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`[data-add-widget="${id}"]`)?.focus());
  };
  const handleAdd = (id: HomeWidgetId) => {
    pendingFocus.current = { id, action: "size" };
    setEnabled(id, true);
    setAnnouncement(`${getWidgetDefinition(id).title} adicionado ao painel.`);
  };
  const handleRestore = () => {
    setUndo(layout);
    restore();
    setAnnouncement("Painel restaurado para o padrão.");
  };
  const handleUndo = () => { if (undo) { restore(undo); setUndo(null); setAnnouncement("Restauração desfeita."); } };
  const startEditing = () => { setEditing(true); setUndo(null); window.requestAnimationFrame(() => panelTitle.current?.focus()); };
  const stopEditing = () => { setEditing(false); setUndo(null); setDrag(null); window.requestAnimationFrame(() => opener.current?.focus()); };

  // ---- arrastar e soltar (opcional; o teclado tem botões equivalentes) ----
  const dragStart = (id: HomeWidgetId, event: DragEvent<HTMLElement>) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-caderno-widget", id);
    const card = (event.currentTarget as HTMLElement).closest<HTMLElement>(".home-widget");
    if (card) event.dataTransfer.setDragImage(card, 16, 16);
    setDrag({ id, over: null });
  };
  const dragOver = (id: HomeWidgetId, event: DragEvent<HTMLElement>) => {
    if (!drag || drag.id === id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const from = visible.findIndex(widget => widget.id === drag.id), to = visible.findIndex(widget => widget.id === id);
    const placement = from < to ? "after" : "before";
    if (drag.over?.id !== id || drag.over.placement !== placement) setDrag({ id: drag.id, over: { id, placement } });
  };
  const drop = (id: HomeWidgetId, event: DragEvent<HTMLElement>) => {
    if (!drag || drag.id === id) return;
    event.preventDefault();
    const placement = drag.over?.id === id ? drag.over.placement : "before";
    const next = moveWidgetTo(layout, drag.id, id, placement);
    moveTo(drag.id, id, placement);
    announceIndex(next, drag.id);
    setDrag(null);
  };

  const submit = (event: { preventDefault(): void }) => { event.preventDefault(); onSearch(query.trim() || undefined); };
  const searchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      // O atalho global abriria a pesquisa vazia; aqui a consulta digitada acompanha.
      event.preventDefault(); event.stopPropagation();
      onSearch(query.trim() || undefined);
    } else if (event.key === "Escape" && query) { event.preventDefault(); event.stopPropagation(); setQuery(""); }
  };
  const rootKey = (event: KeyboardEvent) => { if (event.key === "Escape" && editing && !event.defaultPrevented && !editable(event.target)) { event.preventDefault(); stopEditing(); } };
  const createNote = async () => {
    if (busy) return;
    setBusy(true);
    try { await onNewNote(); } finally { setBusy(false); }
  };

  const now_ = new Date(now);
  const bodyFor = (widget: HomeWidgetState) => {
    const common = { size: widget.size, now, actions };
    switch (widget.id) {
      case "recent": return <HomeRecentBody {...common} data={data.notes} />;
      case "starred": return <HomeStarredBody {...common} data={data.notes} />;
      case "tasks": return <HomeTasksBody {...common} data={data.tasks} reloadTasks={data.reloadTasks} />;
      case "events": return <HomeEventsBody {...common} data={data.events} />;
      case "notebooks": return <HomeNotebooksBody {...common} />;
      case "clock": return <HomeClockBody />;
      case "summary": return <HomeSummaryBody />;
    }
  };

  return <div className="editor-pane home-pane" data-editing={editing || undefined}>
    <div className="editor-scroll home-scroll">
      <section ref={root} className="home-dashboard" role="region" aria-label="Página inicial" aria-busy={opening} onKeyDown={rootKey}>
        <header className="home-hero">
          <div className="home-hero-top">
            <div>
              <h1>{greetingFor(now_)}!</h1>
              <p className="home-date">{formatLongDate(now_)}</p>
            </div>
          </div>
        </header>
        <div className="home-search-zone">
          <form className="home-search-row" role="search" onSubmit={submit}>
            <label className="home-search">
              <Search size={17} aria-hidden="true" />
              <input ref={input} type="search" value={query} maxLength={200} autoComplete="off" spellCheck={false} placeholder="O que você está procurando?" aria-label="Pesquisar no Caderno" onChange={event => setQuery(event.target.value)} onKeyDown={searchKey} />
              <button type="submit" className="home-kbd" aria-label="Abrir pesquisa geral" title={`Abrir pesquisa geral (${isMac ? "⌘" : "Ctrl+"}K)`}><kbd>{isMac ? "⌘" : "Ctrl"}</kbd><kbd>K</kbd></button>
            </label>
          </form>
          <div className="home-shortcuts">
            <button type="button" className="home-ghost home-create" disabled={busy} onClick={() => void createNote()}><Plus size={14} aria-hidden="true" /> Nova nota</button>
            <button ref={opener} type="button" className="home-ghost" aria-pressed={editing} onClick={() => editing ? stopEditing() : startEditing()}>
              <SlidersHorizontal size={14} aria-hidden="true" /> Personalizar painel
            </button>
          </div>
          {opening && <p className="home-opening" role="status">Abrindo nota…</p>}
        </div>

        {editing && <section className="home-customize" aria-label="Personalizar painel">
          <div className="home-customize-head">
            <div>
              <h2 ref={panelTitle} tabIndex={-1}>Personalizar painel</h2>
              <p>Reordene, mude o tamanho ou oculte widgets. As escolhas ficam salvas neste computador.</p>
            </div>
            <div className="home-customize-actions">
              <button type="button" className="home-ghost" data-action="restore" disabled={isDefaultLayout(layout)} onClick={handleRestore}><RotateCcw size={13} aria-hidden="true" /> Restaurar padrão</button>
              <button type="button" className="home-primary compact" data-action="done" aria-label="Concluir personalização" onClick={stopEditing}>Concluir</button>
            </div>
          </div>
          {undo && <p className="home-undo" role="status">Painel restaurado. <button type="button" className="home-link-button" onClick={handleUndo}>Desfazer</button></p>}
          {saveError && <p className="home-inline-error" role="alert">Não foi possível salvar estas preferências; elas valem só até fechar o app.</p>}
          {hidden.length > 0
            ? <ul className="home-available" aria-label="Widgets disponíveis">{hidden.map(widget => {
              const definition = getWidgetDefinition(widget.id), Icon = ICONS[widget.id];
              return <li key={widget.id}><button type="button" data-add-widget={widget.id} aria-label={`Adicionar ${definition.title}`} onClick={() => handleAdd(widget.id)}>
                <Icon size={15} aria-hidden="true" /><span><b>{definition.title}</b><small>{definition.description}</small></span><Plus size={14} aria-hidden="true" />
              </button></li>;
            })}</ul>
            : <p className="home-hint">Todos os widgets disponíveis já estão no painel.</p>}
        </section>}

        <div className="home-sr" role="status" aria-live="polite">{announcement}</div>

        <div className="home-widget-dock">{visible.length === 0
          ? <div className="home-board-empty"><LayoutGrid size={22} aria-hidden="true" /><p>Seu painel não tem widgets.</p>{!editing && <button type="button" className="home-ghost" onClick={startEditing}>Adicionar widgets</button>}</div>
          : <div className="home-grid">{visible.map((widget, index) => <HomeWidgetFrame
            key={widget.id} widget={widget} index={index} count={visible.length} editing={editing} dragging={drag?.id ?? null}
            dropMark={drag?.over?.id === widget.id ? drag.over.placement : null}
            onMove={handleMove} onToggleSize={handleSize} onHide={handleHide}
            onDragStart={dragStart} onDragOver={dragOver} onDrop={drop} onDragEnd={() => setDrag(null)} onLink={onNavigate}
          >{bodyFor(widget)}</HomeWidgetFrame>)}</div>}</div>
      </section>
    </div>
  </div>;
}
