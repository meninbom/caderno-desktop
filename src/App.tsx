import React, {lazy,Suspense,useEffect,useRef,useState} from "react";
import { X, Search, PanelLeftOpen, PanelRightOpen, Minus, Square,NotebookPen } from "lucide-react";
import { Sidebar } from "./components/Sidebar";
import { NoteList } from "./components/NoteList";
import { useAppStore } from "./state/store";
import { client } from "./api/client";
import { useAppearance } from "./state/appearance";
import { useBackgroundAsset } from "./state/backgroundAsset";
import { WorkspaceBackground } from "./components/WorkspaceBackground";
import {useAttachmentJobs} from "./hooks/useAttachmentJobs";

import type {PaletteCommand} from './components/CommandPalette';
import { TaskDialog, EventDialog } from './components/AgendaDialogs';
import { TagManager } from './components/TagManager';
import { TemplatePickerDialog } from './components/TemplateDialogs';

const NoteEditor=lazy(()=>import("./components/NoteEditor").then(m=>({default:m.NoteEditor})));
const SettingsPage=lazy(()=>import("./components/SettingsPage").then(m=>({default:m.SettingsPage})));
const LocalAgenda=lazy(()=>import("./components/LocalAgenda").then(m=>({default:m.LocalAgenda})));
const CommandPalette=lazy(()=>import("./components/CommandPalette").then(m=>({default:m.CommandPalette})));
const HomeDashboard=lazy(()=>import("./components/HomeDashboard").then(m=>({default:m.HomeDashboard})));
function EmptyEditor({loading=false}:{loading?:boolean}){return <div className="editor-pane"><div className="editor-scroll"><div className="empty-state" style={{margin:"18vh auto",maxWidth:420}}><NotebookPen size={24} strokeWidth={1.6}/><span role={loading?"status":undefined}>{loading?"Abrindo nota…":"Selecione ou crie uma nota."}</span></div></div></div>;}
function AreaLoading(){return <div className="area-loading" role="status">Carregando…</div>;}

export function App() {
  const { state, dispatch, refreshMeta, refreshNotes, openNote } = useAppStore();
  const editorStarted=useRef(false);if(state.openNote)editorStarted.current=true;
  const activeNoteId=useRef(state.openNoteId);activeNoteId.current=state.openNoteId;
  useEffect(()=>{
    const offPrepare=window.cadernoDesktop?.onPrepareClipAppend?.(async value=>{
      if(activeNoteId.current!==value.noteId||!document.querySelector(".tiptap"))return;
      await new Promise<void>((resolve,reject)=>window.dispatchEvent(new CustomEvent("caderno:lock-clip-append",{detail:{...value,resolve,reject}})));
    });
    const offFinish=window.cadernoDesktop?.onClipAppendFinished?.(value=>{
      window.dispatchEvent(new CustomEvent("caderno:finish-clip-append",{detail:value}));
      if(value.note&&activeNoteId.current===value.noteId)dispatch({type:"openNote",note:value.note,noteId:value.noteId});
    });
    return()=>{offPrepare?.();offFinish?.();};
  },[dispatch]);
  const importRef = useRef<HTMLInputElement>(null);
  const [toast, setToastRaw] = useState<string | null>(null);
  const setToast = (message: string | null) => { setToastRaw(message); if (message) dispatch({ type: "log", level: /falha|inválid|indispon|não foi/i.test(message) ? "error" : "info", message }); };
  const [area,setArea]=useState<'notes'|'tasks'|'calendar'|'settings'>('notes');
  const { appearance, update, reset, saveError } = useAppearance();
  const background = useBackgroundAsset();
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "\\" || !e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      if (e.altKey) update({ listCollapsed: !appearance.listCollapsed });
      else update({ sidebarCollapsed: !appearance.sidebarCollapsed });
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [appearance.sidebarCollapsed, appearance.listCollapsed, update]);
  const {jobs,refreshJobs}=useAttachmentJobs();
  const [seenLogId, setSeenLogId] = useState(0);
  useEffect(() => { if (area === "settings") setSeenLogId(state.log[0]?.id ?? 0); }, [area, state.log]);
  const alerts = jobs.filter((j) => j.status === "error").length + state.log.filter((l) => l.level === "error" && l.id > seenLogId).length;
  const [clipperOpen,setClipperOpen]=useState(false);
  const [templatesOpen,setTemplatesOpen]=useState(false);
  const [paletteOpen,setPaletteOpen]=useState(false),[quickTask,setQuickTask]=useState(false),[quickEvent,setQuickEvent]=useState(false),[tagsOpen,setTagsOpen]=useState(false);
  const [paletteQuery,setPaletteQuery]=useState('');
  const [creatingNote,setCreatingNote]=useState(false);const creatingNoteRef=useRef(false);
  const openPalette=async(query='')=>{
    if(document.querySelector('[aria-modal="true"]'))return;
    try{
      if(area==='notes'&&state.openNote&&document.querySelector('.tiptap'))await new Promise<void>((resolve,reject)=>window.dispatchEvent(new CustomEvent('caderno:flush-editor',{detail:{resolve,reject}})));
      setPaletteQuery(query.slice(0,200));setPaletteOpen(true);
    }catch(e){setToast(`Falha ao salvar a nota: ${(e as Error).message}`)}
  };
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();void openPalette()}};const error=(e:Event)=>setToast((e as CustomEvent<string>).detail);window.addEventListener('keydown',key);window.addEventListener('caderno:command-error',error);return()=>{window.removeEventListener('keydown',key);window.removeEventListener('caderno:command-error',error)}},[area,state.openNote]);

  useEffect(() => {
    if (!state.error) return;
    const t = window.setTimeout(() => dispatch({ type: "error", message: null }), 6000);
    return () => window.clearTimeout(t);
  }, [state.error]);
  useEffect(()=>{const bridge=(window as unknown as {cadernoDesktop?:{onReminder?:(listener:(kind:'click'|'fallback',value:string)=>void)=>()=>void}}).cadernoDesktop;return bridge?.onReminder?.((kind,value)=>{if(kind==='fallback'){setToast(`Notificação do sistema indisponível. Lembrete entregue enquanto o app estava aberto: ${value}`);return;}void client.listTasks('all').then(tasks=>{const task=tasks.find(t=>t.id===value);if(task){setArea('notes');void openNote(task.noteId);}}).catch(()=>{});});},[openNote]);
  useEffect(() => window.cadernoDesktop?.onOpenNote?.(noteId => {
    void (async () => {
      if (area === "notes" && state.openNote) {
        await new Promise<void>((resolve, reject) => window.dispatchEvent(new CustomEvent("caderno:flush-editor", { detail: { resolve, reject } })));
      }
      dispatch({ type: "selection", selection: { kind: "all" } });
      setArea("notes");
      await openNote(noteId);
    })().catch(error => dispatch({ type: "error", message: `Não foi possível abrir a nota solicitada: ${(error as Error).message}` }));
  }), [area, state.openNote, dispatch, openNote]);

  const importMarkdown = async (files: FileList | null, notebookId: number | null, folderId?: string | null) => {
    if (!files || files.length === 0) return;
    try {
      const items: { fileName: string; content: string }[] = [];
      for (const f of Array.from(files)) items.push({ fileName: f.name, content: await f.text() });
      const result = await client.importMarkdown(items, notebookId, folderId);
      setToast(`${result.created} nota(s) importada(s) de Markdown.`);
      await refreshMeta();
      await refreshNotes();
    } catch (err) {
      setToast(`Falha na importação: ${(err as Error).message}`);
    }
  };

  const restoreBackup = async () => {
    if (!window.confirm("Restaurar o backup mescla notas, cadernos e anexos incluídos no arquivo. Backups JSON antigos não incluem anexos, então imagens e arquivos deles não serão recuperados. Continuar?")) return;
    try {
      const result = await client.restoreBackup();
      if (result && "ok" in result && result.ok === true) {
        setToast(result.legacy ? `Backup antigo restaurado: ${result.notes} nota(s), ${result.notebooks} caderno(s). Limitação: este formato não inclui anexos/imagens.` : `Backup restaurado: ${result.notes} nota(s), ${result.notebooks} caderno(s), ${result.assets??0} anexo(s).`);
        await refreshMeta();
        await refreshNotes();
      } else if (result && "ok" in result && result.ok === false) {
        setToast(`Backup inválido, nada foi alterado: ${result.error}`);
      }
    } catch (err) {
      setToast(`Falha ao restaurar: ${(err as Error).message}`);
    }
  };

  const saveBackup = async () => {
    try {
      const result = await client.saveBackup();
      if (result && result.filePath) setToast(`Backup completo salvo em ${result.filePath}.`);
    } catch (err) {
      setToast(`Falha no backup: ${(err as Error).message}`);
    }
  };

  const importEml = async () => {try{const notebookId=state.selection.kind==='notebook'||state.selection.kind==='folder'?state.selection.notebookId:null;const folderId=state.selection.kind==='folder'?state.selection.folderId:undefined;const result=await client.importEml(notebookId, folderId);if(result.canceled)return;setToast(`${result.created} e-mail(s) importado(s), ${result.duplicates} duplicado(s), ${result.attachments} anexo(s).${result.errors.length?` Falhas: ${result.errors.join(' | ')}`:''}`);await refreshMeta();await refreshNotes();}catch(err){setToast(`Falha na importação: ${(err as Error).message}`);}};

  const showHome=async()=>{
    try{
      if(document.querySelector('.tiptap'))await new Promise<void>((resolve,reject)=>window.dispatchEvent(new CustomEvent('caderno:flush-editor',{detail:{resolve,reject}})));
      await openNote(null);dispatch({type:'selection',selection:{kind:'all'}});dispatch({type:'search',value:''});setArea('notes');
    }catch(error){setToast(`Falha ao salvar a nota: ${(error as Error).message}`);}
  };
  const newNoteFromHome=async(resetSelection=false)=>{
    if(creatingNoteRef.current)return;creatingNoteRef.current=true;setCreatingNote(true);
    try{if(document.querySelector('.tiptap'))await new Promise<void>((resolve,reject)=>window.dispatchEvent(new CustomEvent('caderno:flush-editor',{detail:{resolve,reject}})));setArea('notes');const selection=state.selection;const note=await client.createNote(selection.kind==='folder'?{notebookId:selection.notebookId,folderId:selection.folderId}:selection.kind==='notebook'?{notebookId:selection.notebookId}:{});dispatch({type:'search',value:''});if(resetSelection||selection.kind==='trash')dispatch({type:'selection',selection:{kind:'all'}});await refreshMeta();await refreshNotes();await openNote(note.id);}
    catch(error){setToast(`Falha ao criar a nota: ${(error as Error).message}`);}
    finally{creatingNoteRef.current=false;setCreatingNote(false);}
  };
  const home=<Suspense fallback={<AreaLoading/>}><HomeDashboard onSearch={query=>void openPalette(query)} onNewNote={newNoteFromHome} onNavigate={setArea} onOpenNote={async id=>{setArea('notes');await openNote(id);}} onOpenNotebook={id=>{dispatch({type:'selection',selection:{kind:'notebook',notebookId:id}});dispatch({type:'search',value:''});update({listCollapsed:false});}}/></Suspense>;

  const commands:PaletteCommand[]=[
    {id:'home',title:'Abrir início',description:'Pesquisa e widgets da tela inicial',keywords:'home widgets painel',run:showHome},
    {id:'create-note',title:'Criar nota',description:'Começar uma nova nota',keywords:'nova escrever',run:()=>newNoteFromHome(true)},
    {id:'new-from-template',title:'Nova nota a partir de modelo',description:'Escolher um modelo, ver a prévia e criar uma nota',keywords:'modelos template ata reunião projeto',run:()=>{setArea('notes');setTemplatesOpen(true)}},
    {id:'save-template',title:'Salvar nota como modelo',description:'Guardar o conteúdo atual como modelo reutilizável',keywords:'template',run:()=>{if(!state.openNote||state.openNote.deletedAt!==null)throw new Error('Abra uma nota para salvá-la como modelo.');window.dispatchEvent(new Event('caderno:save-template'))}},
    {id:'reference-note',title:'Abrir nota de referência ao lado',description:'Consultar outra nota somente leitura ao lado da principal',keywords:'lado a lado dividir painel',run:()=>{if(!state.openNote)throw new Error('Abra uma nota principal primeiro.');window.dispatchEvent(new Event('caderno:pick-reference'))}},
    {id:'export-pdf',title:'Exportar nota como PDF',description:'Salvar a nota aberta em PDF paginado',keywords:'pdf imprimir exportar',run:()=>{if(!state.openNote)throw new Error('Abra uma nota para exportar.');window.dispatchEvent(new CustomEvent('caderno:export-note',{detail:'pdf'}))}},
    {id:'export-html',title:'Exportar nota como HTML',description:'Salvar a nota aberta como página HTML offline',keywords:'html exportar web',run:()=>{if(!state.openNote)throw new Error('Abra uma nota para exportar.');window.dispatchEvent(new CustomEvent('caderno:export-note',{detail:'html'}))}},
    {id:'create-task',title:'Criar tarefa',description:'Prazo, lembrete, prioridade e recorrência',keywords:'nova',run:()=>setQuickTask(true)},
    {id:'create-event',title:'Criar evento',description:'Adicionar um compromisso ao calendário',keywords:'novo agenda',run:()=>setQuickEvent(true)},
    {id:'notes',title:'Abrir notas',description:'Ver todas as notas',run:()=>{dispatch({type:'selection',selection:{kind:'all'}});dispatch({type:'search',value:''});setArea('notes')}},
    {id:'tasks',title:'Abrir tarefas',description:'Ver prazos e tarefas recorrentes',run:()=>setArea('tasks')},
    {id:'calendar',title:'Abrir calendário',description:'Consultar eventos e compromissos',run:()=>setArea('calendar')},
    {id:'settings',title:'Abrir configurações',description:'Aparência, anexos e preferências',run:()=>setArea('settings')},
    {id:'tags',title:'Gerenciar tags',description:'Criar, renomear ou excluir etiquetas',run:()=>setTagsOpen(true)},
    {id:'theme',title:'Alternar tema',description:state.theme==='dark'?'Ativar tema claro':'Ativar tema escuro',run:async()=>{const value=state.theme==='dark'?'light':'dark';await client.setTheme(value);dispatch({type:'theme',theme:value})}},
    {id:'sidebar',title:appearance.sidebarCollapsed?'Expandir barra lateral':'Recolher barra lateral',description:'Mostrar ou ocultar a navegação',run:()=>update({sidebarCollapsed:!appearance.sidebarCollapsed})},
    {id:'backup',title:'Salvar backup',description:'Exportar notas, anexos e marcações',run:saveBackup},
  ];
  const agendaSaved=()=>{setQuickTask(false);setQuickEvent(false);window.dispatchEvent(new Event('caderno:agenda-changed'));};

  return (
    <div className="app">
      <WorkspaceBackground appearance={appearance} imageUrl={background.url}/>
      {window.cadernoDesktop?.windowControls && <div className="window-controls-trigger"><div className="window-controls" role="group" aria-label="Controles da janela">
        <button aria-label="Minimizar janela" title="Minimizar" onClick={() => window.cadernoDesktop?.windowControls?.minimize()}><Minus size={15} /></button>
        <button aria-label="Maximizar ou restaurar janela" title="Maximizar ou restaurar" onClick={() => window.cadernoDesktop?.windowControls?.maximize()}><Square size={12} /></button>
        <button className="window-close" aria-label="Fechar janela" title="Fechar" onClick={() => window.cadernoDesktop?.windowControls?.close()}><X size={15} /></button>
      </div></div>}
      <Sidebar
        area={area} onArea={setArea} onHome={()=>void showHome()} onNewNote={newNoteFromHome} creatingNote={creatingNote} onCommand={()=>void openPalette()} onTemplates={()=>{setArea('notes');setTemplatesOpen(true)}}
        onImportClick={() => importRef.current?.click()}
        onImportEml={() => void importEml()}
        onSaveBackup={() => void saveBackup()}
        onRestoreBackup={() => void restoreBackup()}
        onClipper={() => setClipperOpen(true)}
        onCollapse={() => update({ sidebarCollapsed: true })}
        onSettings={() => setArea((a) => (a === "settings" ? "notes" : "settings"))} alerts={alerts}
      />
      {area==='settings'?<Suspense fallback={<AreaLoading/>}><SettingsPage appearance={appearance} update={update} reset={reset} background={background} saveError={saveError} jobs={jobs} refreshJobs={refreshJobs} onSaveBackup={() => void saveBackup()} onRestoreBackup={() => void restoreBackup()} onImportClick={() => importRef.current?.click()} onImportEml={() => void importEml()} onClipper={() => setClipperOpen(true)} /></Suspense>:area==='notes'?<><NoteList onCollapse={() => update({ listCollapsed: true })} />{editorStarted.current?<Suspense fallback={<EmptyEditor loading/>}><NoteEditor opening={creatingNote} emptyState={home} appearance={appearance} onAppearanceChange={update} /></Suspense>:home}</>:<Suspense fallback={<AreaLoading/>}><LocalAgenda area={area} openNote={async id=>{setArea('notes');if(id)await openNote(id);}}/></Suspense>}
      <input
        ref={importRef}
        type="file"
        accept=".md,.markdown,.txt"
        multiple
        hidden
        onChange={(e) => {
          const sel = state.selection;
          const notebookId = sel.kind === "notebook" || sel.kind === "folder" ? sel.notebookId : null;
          const folderId = sel.kind === "folder" ? sel.folderId : undefined;
          void importMarkdown(e.target.files, notebookId, folderId);
          e.target.value = "";
        }}
      />
      {(appearance.sidebarCollapsed || (appearance.listCollapsed && area === "notes")) && (
        <div className="pane-rail">
          {appearance.sidebarCollapsed&&<button aria-label="Pesquisar no Caderno" title="Pesquisar no Caderno (Ctrl+K)" onClick={()=>void openPalette()}><Search size={15}/></button>}
          {appearance.sidebarCollapsed && <button title="Expandir barra lateral (Ctrl+\)" aria-label="Expandir barra lateral" onClick={() => update({ sidebarCollapsed: false })}><PanelLeftOpen size={15} /></button>}
          {appearance.listCollapsed && area === "notes" && <button title="Expandir lista de notas (Ctrl+Alt+\)" aria-label="Expandir lista de notas" onClick={() => update({ listCollapsed: false })}><PanelRightOpen size={15} /><span>Notas</span></button>}
        </div>
      )}
      {state.error && (
        <div className="error-bar app-toast" role="alert">
          <span>{state.error}</span>
          <button className="ghost" onClick={() => dispatch({ type: "error", message: null })}><X size={13} /></button>
        </div>
      )}
      {toast && (
        <div className="error-bar app-toast app-toast-info">
          <span>{toast}</span>
          <button className="ghost" onClick={() => setToast(null)}><X size={13} /></button>
        </div>
      )}
      {paletteOpen&&<Suspense fallback={<div className="overlay"><span role="status">Abrindo busca…</span></div>}><CommandPalette initialQuery={paletteQuery} commands={commands} onClose={()=>setPaletteOpen(false)} onNote={async id=>{dispatch({type:"selection",selection:{kind:"all"}});dispatch({type:"search",value:""});setArea("notes");await openNote(id);}}/></Suspense>}
      {quickTask&&<TaskDialog initialNoteId={state.openNote?.deletedAt?null:state.openNoteId} onClose={()=>setQuickTask(false)} onSaved={agendaSaved}/>}
      {quickEvent&&<EventDialog onClose={()=>setQuickEvent(false)} onSaved={agendaSaved}/>}
      {tagsOpen&&<TagManager onClose={()=>setTagsOpen(false)}/>}
      {templatesOpen&&<TemplatePickerDialog notebookId={state.selection.kind==='notebook'||state.selection.kind==='folder'?state.selection.notebookId:null} folderId={state.selection.kind==='folder'?state.selection.folderId:null} onClose={()=>setTemplatesOpen(false)} onCreated={async id=>{if(state.selection.kind==='trash')dispatch({type:'selection',selection:{kind:'all'}});await refreshMeta();await refreshNotes();await openNote(id)}}/>}
      {clipperOpen && <ClipperSettings onClose={()=>setClipperOpen(false)} />}
    </div>
  );
}

function ClipperSettings({onClose}:{onClose:()=>void}) {
  const [status,setStatus]=useState<{enabled:boolean;paired:boolean;port:number|null}>({enabled:false,paired:false,port:null});
  const [pairing,setPairing]=useState<{code:string;nonce:string;expiresAt:number}|null>(null); const [error,setError]=useState(""); const [busy,setBusy]=useState(false);
  const refresh=()=>client.clipperStatus().then(setStatus).catch(e=>setError(e.message));
  useEffect(()=>{void refresh();const timer=window.setInterval(()=>void refresh(),1000);return()=>window.clearInterval(timer);},[]);
  const run=async(fn:()=>Promise<unknown>)=>{setBusy(true);setError("");try{await fn();await refresh();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
  return <div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><section className="modal app-dialog" role="dialog" aria-modal="true" aria-labelledby="clipper-title" onKeyDown={e=>{if(e.key==="Escape")onClose();}}>
    <h3 id="clipper-title">Web Clipper</h3><p>Guarde páginas neste app. A conexão funciona só enquanto o Caderno estiver aberto.</p>
    <p role="status">{status.enabled?`Conexão local ativa em 127.0.0.1:${status.port}.`:"Conexão desativada."} {status.paired?"Extensão pareada.":"Extensão ainda não pareada."}</p>
    {!status.enabled&&<button disabled={busy} onClick={()=>void run(()=>client.enableClipper())}>Configurar Clipper</button>}
    {status.enabled&&!status.paired&&<button disabled={busy} onClick={()=>void run(async()=>{setPairing(await client.pairClipper());})}>Gerar código de pareamento</button>}
    {status.enabled&&!status.paired&&<button disabled={busy} onClick={()=>void run(()=>client.revokeClipper())}>Desativar conexão local</button>}
    {pairing&&<div><p>Código válido por 2 minutos:</p><strong style={{fontSize:24,letterSpacing:4}}>{pairing.code}</strong><p>Código de conexão (copie para a extensão):</p><code style={{overflowWrap:"anywhere",fontSize:11}}>{pairing.nonce}</code><p>Informe os dois valores na extensão.</p></div>}
    {status.paired&&<button disabled={busy} onClick={()=>void run(()=>client.revokeClipper())}>Desconectar e revogar acesso</button>}
    {error&&<p role="alert">{error}</p>}<div className="row"><button onClick={onClose}>Fechar</button></div>
  </section></div>;
}
