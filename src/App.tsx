import React, { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Sidebar } from "./components/Sidebar";
import { NoteList } from "./components/NoteList";
import { NoteEditor } from "./components/NoteEditor";
import { useAppStore } from "./state/store";
import { client } from "./api/client";
import {LocalAgenda} from './components/LocalAgenda';

export function App() {
  const { state, dispatch, refreshMeta, refreshNotes, openNote } = useAppStore();
  const importRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [area,setArea]=useState<'notes'|'tasks'|'calendar'>('notes');
  const [clipperOpen,setClipperOpen]=useState(false);

  useEffect(() => {
    if (!state.error) return;
    const t = window.setTimeout(() => dispatch({ type: "error", message: null }), 6000);
    return () => window.clearTimeout(t);
  }, [state.error]);
  useEffect(()=>{const bridge=(window as unknown as {cadernoDesktop?:{onReminder?:(listener:(kind:'click'|'fallback',value:string)=>void)=>()=>void}}).cadernoDesktop;return bridge?.onReminder?.((kind,value)=>{if(kind==='fallback'){setToast(`Notificação do sistema indisponível. Lembrete entregue enquanto o app estava aberto: ${value}`);return;}void client.listTasks('all').then(tasks=>{const task=tasks.find(t=>t.id===value);if(task){setArea('notes');void openNote(task.noteId);}}).catch(()=>{});});},[openNote]);

  const importMarkdown = async (files: FileList | null, notebookId: number | null) => {
    if (!files || files.length === 0) return;
    try {
      const items: { fileName: string; content: string }[] = [];
      for (const f of Array.from(files)) items.push({ fileName: f.name, content: await f.text() });
      const result = await client.importMarkdown(items, notebookId);
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

  void state.selection;

  return (
    <div className="app">
      <Sidebar
        area={area} onArea={setArea}
        onImportClick={() => importRef.current?.click()}
        onImportEml={() => void (async()=>{try{const notebookId=state.selection.kind==='notebook'?state.selection.notebookId:null;const result=await client.importEml(notebookId);if(result.canceled)return;setToast(`${result.created} e-mail(s) importado(s), ${result.duplicates} duplicado(s), ${result.attachments} anexo(s).${result.errors.length?` Falhas: ${result.errors.join(' | ')}`:''}`);await refreshMeta();await refreshNotes();}catch(err){setToast(`Falha na importação: ${(err as Error).message}`);}})()}
        onSaveBackup={() => void saveBackup()}
        onRestoreBackup={() => void restoreBackup()}
        onClipper={() => setClipperOpen(true)}
      />
      {area==='notes'?<><NoteList /><NoteEditor /></>:<LocalAgenda area={area} openNote={async id=>{setArea('notes');if(id)await openNote(id);}}/>}
      <input
        ref={importRef}
        type="file"
        accept=".md,.markdown,.txt"
        multiple
        hidden
        onChange={(e) => {
          const sel = state.selection;
          const notebookId = sel.kind === "notebook" ? sel.notebookId : null;
          void importMarkdown(e.target.files, notebookId);
          e.target.value = "";
        }}
      />
      {state.error && (
        <div className="error-bar" role="alert" style={{ position: "fixed", top: 0, left: 216, right: 150, zIndex: 100 }}>
          <span>{state.error}</span>
          <button className="ghost" onClick={() => dispatch({ type: "error", message: null })}><X size={13} /></button>
        </div>
      )}
      {toast && (
        <div className="error-bar" style={{ position: "fixed", top: 0, left: 216, right: 150, zIndex: 100, background: "var(--accent-soft)", color: "var(--accent)" }}>
          <span>{toast}</span>
          <button className="ghost" onClick={() => setToast(null)}><X size={13} /></button>
        </div>
      )}
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
  return <div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><section className="modal stack-dialog" role="dialog" aria-modal="true" aria-labelledby="clipper-title" onKeyDown={e=>{if(e.key==="Escape")onClose();}}>
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
