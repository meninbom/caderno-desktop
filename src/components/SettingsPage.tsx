import React, { useEffect, useState } from "react";
import { Palette, PenLine, ScanSearch, Database, Bell, Globe, RotateCcw, Trash2, Command, Settings } from "lucide-react";
import { useAppStore } from "../state/store";
import { client } from "../api/client";
import { ACCENT_PRESETS, DEFAULT_APPEARANCE, type Appearance } from "../state/appearance";
import type { AttachmentJob } from "../../shared/ipc";

type Section = "general" | "appearance" | "editor" | "indexing" | "data" | "clipper" | "raycast" | "log";

const SECTIONS: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: "general", label: "Geral", icon: <Settings size={15} /> },
  { id: "appearance", label: "Aparência", icon: <Palette size={15} /> },
  { id: "editor", label: "Editor", icon: <PenLine size={15} /> },
  { id: "indexing", label: "Indexação de anexos", icon: <ScanSearch size={15} /> },
  { id: "data", label: "Dados e backup", icon: <Database size={15} /> },
  { id: "clipper", label: "Web Clipper", icon: <Globe size={15} /> },
  { id: "raycast", label: "Raycast", icon: <Command size={15} /> },
  { id: "log", label: "Avisos e erros", icon: <Bell size={15} /> },
];

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-label"><span>{label}</span>{hint && <small>{hint}</small>}</div>
      <div className="set-control">{children}</div>
    </div>
  );
}

function Slider({ label, hint, value, min, max, step, unit, onChange }: {
  label: string; hint?: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void;
}) {
  return (
    <Row label={label} hint={hint}>
      <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <output>{Math.round(value * 100) / 100}{unit}</output>
    </Row>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Row label={label} hint={hint}>
      <button role="switch" aria-checked={checked} aria-label={label} className={`switch${checked ? " on" : ""}`} onClick={() => onChange(!checked)}><span /></button>
    </Row>
  );
}

function Segmented<T extends string>({ label, hint, value, options, onChange }: {
  label: string; hint?: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <Row label={label} hint={hint}>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map((o) => <button key={o.value} role="radio" aria-checked={value === o.value} className={value === o.value ? "on" : undefined} onClick={() => onChange(o.value)}>{o.label}</button>)}
      </div>
    </Row>
  );
}

function jobText(j: AttachmentJob) {
  if (j.status === "running") return `processando ${j.progress}%${j.totalPages ? ` · página ${Math.min(j.checkpoint, j.totalPages)}/${j.totalPages}` : ""}`;
  return j.status;
}

export function SettingsPage({ appearance, update, reset, jobs, refreshJobs, onSaveBackup, onRestoreBackup, onImportClick, onImportEml, onClipper }: {
  appearance: Appearance; update: (patch: Partial<Appearance>) => void; reset: () => void;
  jobs: AttachmentJob[]; refreshJobs: () => Promise<void>;
  onSaveBackup: () => void; onRestoreBackup: () => void; onImportClick: () => void; onImportEml: () => void; onClipper: () => void;
}) {
  const { state, dispatch } = useAppStore();
  const [section, setSection] = useState<Section>("appearance");
  const [startup, setStartup] = useState<{ available: boolean; enabled: boolean } | null>(null);
  const [startupBusy, setStartupBusy] = useState(false);
  const [startupError, setStartupError] = useState("");
  const [raycastStatus, setRaycastStatus] = useState<{ enabled: boolean; paired: boolean; port: number | null } | null>(null);
  const [raycastCode, setRaycastCode] = useState<{ value: string; expiresAt: number } | null>(null);
  const [raycastError, setRaycastError] = useState("");
  const [raycastBusy, setRaycastBusy] = useState(false);
  const customAccent = appearance.accent ?? "#1b4ed8";
  const errorJobs = jobs.filter((j) => j.status === "error").length;
  const errorLogs = state.log.filter((l) => l.level === "error").length;

  useEffect(() => {
    if (section !== "general") return;
    let active = true;
    const refresh = () => {
      const bridge = window.cadernoDesktop;
      if (!bridge) { setStartup(null); setStartupError("Disponível no aplicativo instalado no Windows."); return; }
      void bridge.invoke("startup:get", null).then(result => {
        if (!active) return;
        if (result.ok) { setStartup(result.data as { available: boolean; enabled: boolean }); setStartupError(""); }
        else { setStartup(null); setStartupError(result.error); }
      }).catch(error => { if (active) { setStartup(null); setStartupError((error as Error).message); } });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => { active = false; window.removeEventListener("focus", refresh); };
  }, [section]);

  const changeStartup = async (enabled: boolean) => {
    setStartupBusy(true); setStartupError("");
    try {
      const result = await window.cadernoDesktop!.invoke("startup:set", { enabled });
      if (!result.ok) throw new Error(result.error);
      setStartup(result.data as { available: boolean; enabled: boolean });
    } catch (error) {
      setStartupError((error as Error).message);
      const result = await window.cadernoDesktop!.invoke("startup:get", null).catch(() => null);
      setStartup(result?.ok ? result.data as { available: boolean; enabled: boolean } : null);
    } finally { setStartupBusy(false); }
  };

  useEffect(() => {
    if (section !== "raycast") return;
    const bridge = window.cadernoDesktop;
    if (!bridge) { setRaycastStatus(null); setRaycastError("A conexão Raycast está disponível somente no app desktop."); return; }
    let active = true;
    const refreshStatus = () => void bridge.invoke("raycast:status", null).then(result => {
      if (!active) return;
      if (result.ok) { setRaycastStatus(result.data as { enabled: boolean; paired: boolean; port: number | null }); setRaycastError(""); }
      else setRaycastError(result.error);
    }).catch(error => { if (active) setRaycastError((error as Error).message); });
    refreshStatus();
    window.addEventListener("focus", refreshStatus);
    return () => { active = false; window.removeEventListener("focus", refreshStatus); };
  }, [section]);

  useEffect(() => {
    if (!raycastCode) return;
    const timer = window.setTimeout(() => setRaycastCode(null), Math.max(0, raycastCode.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [raycastCode]);

  const raycastInvoke = async <T,>(channel: string): Promise<T> => {
    const bridge = window.cadernoDesktop;
    if (!bridge) throw new Error("Abra estas configurações no app desktop.");
    const result = await bridge.invoke(channel, null);
    if (!result.ok) throw new Error(result.error);
    return result.data as T;
  };

  const runRaycastAction = async (action: "enable" | "pair" | "revoke") => {
    setRaycastBusy(true); setRaycastError("");
    try {
      if (action === "enable") {
        const result = await raycastInvoke<{ port: number }>("raycast:enable");
        setRaycastStatus(await raycastInvoke<{ enabled: boolean; paired: boolean; port: number | null }>("raycast:status"));
        setRaycastCode(null);
        if (result.port !== 43188) throw new Error("A porta da integração retornou um valor inesperado.");
      } else if (action === "pair") {
        const result = await raycastInvoke<{ code: string; expiresAt: number }>("raycast:pair");
        setRaycastCode({ value: result.code, expiresAt: result.expiresAt });
      } else {
        await raycastInvoke<boolean>("raycast:revoke");
        setRaycastStatus({ enabled: false, paired: false, port: null });
        setRaycastCode(null);
      }
    } catch (error) { setRaycastError((error as Error).message); }
    finally { setRaycastBusy(false); }
  };

  return (
    <section className="settings" aria-label="Configurações">
      <nav className="settings-nav" aria-label="Seções de configurações">
        <h1>Configurações</h1>
        {SECTIONS.map((s) => (
          <button key={s.id} className={section === s.id ? "active" : undefined} aria-current={section === s.id ? "page" : undefined} onClick={() => setSection(s.id)}>
            {s.icon}<span>{s.label}</span>
            {s.id === "indexing" && errorJobs > 0 && <em className="badge">{errorJobs}</em>}
            {s.id === "log" && errorLogs > 0 && <em className="badge">{errorLogs}</em>}
          </button>
        ))}
      </nav>

      <div className="settings-body">
        {section === "general" && <>
          <h2>Geral</h2>
          <Row label="Iniciar com o Windows" hint="Abre o Caderno automaticamente ao entrar no Windows.">
            <button role="switch" aria-label="Iniciar com o Windows" aria-checked={startup?.enabled ?? false} disabled={!startup?.available || startupBusy} className={`switch${startup?.enabled ? " on" : ""}`} onClick={() => void changeStartup(!startup?.enabled)}><span /></button>
          </Row>
          {startup && !startup.available && <p className="set-note">Disponível no aplicativo instalado no Windows.</p>}
          {startupError && <p role="alert" className="set-note">{startupError}</p>}
        </>}
        {section === "appearance" && <>
          <h2>Aparência</h2>
          <Segmented label="Tema" value={state.theme} options={[{ value: "light", label: "Claro" }, { value: "dark", label: "Escuro" }]} onChange={(theme) => dispatch({ type: "theme", theme })} />
          <Row label="Cor de destaque" hint="Botões, seleção, links e foco.">
            <div className="swatches" role="radiogroup" aria-label="Cor de destaque">
              {ACCENT_PRESETS.map((p) => (
                <button key={p.name} role="radio" aria-checked={appearance.accent === p.value} title={p.name} aria-label={p.name}
                  className={`swatch${appearance.accent === p.value ? " on" : ""}`} style={{ background: p.value ?? "#1b4ed8" }} onClick={() => update({ accent: p.value })} />
              ))}
              <input type="color" aria-label="Cor personalizada" value={customAccent} onChange={(e) => update({ accent: e.target.value })} />
            </div>
          </Row>
          <Toggle label="Recolher barra lateral" hint="Atalho: Ctrl+\" checked={appearance.sidebarCollapsed} onChange={(sidebarCollapsed) => update({ sidebarCollapsed })} />
          <Toggle label="Recolher lista de notas" hint="Atalho: Ctrl+Alt+\" checked={appearance.listCollapsed} onChange={(listCollapsed) => update({ listCollapsed })} />
          <Slider label="Largura da barra lateral" value={appearance.sidebarWidth} min={190} max={320} step={2} unit="px" onChange={(v) => update({ sidebarWidth: v })} />
          <Slider label="Largura da lista de notas" value={appearance.listWidth} min={230} max={420} step={2} unit="px" onChange={(v) => update({ listWidth: v })} />
        </>}

        {section === "editor" && <>
          <h2>Editor</h2>
          <Segmented label="Fonte do texto" value={appearance.editorFont} options={[{ value: "sans", label: "Sem serifa" }, { value: "serif", label: "Serifada" }, { value: "mono", label: "Monoespaçada" }]} onChange={(editorFont) => update({ editorFont })} />
          <Slider label="Tamanho do texto" value={appearance.editorSize} min={13} max={22} step={0.5} unit="px" onChange={(v) => update({ editorSize: v })} />
          <Slider label="Altura da linha" value={appearance.lineHeight} min={1.3} max={2.2} step={0.05} unit="" onChange={(v) => update({ lineHeight: v })} />
          <Slider label="Espaço entre parágrafos" value={appearance.paragraphGap} min={0} max={1.5} step={0.05} unit="em" onChange={(v) => update({ paragraphGap: v })} />
          <Toggle label="Usar toda a largura disponível" hint="Expande a escrita até as margens laterais." checked={appearance.fullWidth} onChange={(fullWidth) => update({ fullWidth })} />
          <Slider label="Largura da área de escrita" hint="Limite do texto quando a largura automática está desativada." value={appearance.contentWidth} min={320} max={2400} step={20} unit="px" onChange={(v) => update({ contentWidth: v, fullWidth: false })} />
          <Slider label="Margem lateral mínima" value={appearance.editorGutter} min={12} max={160} step={4} unit="px" onChange={(editorGutter) => update({ editorGutter })} />
          <Toggle label="Barra de formatação flutuante" hint="Bolha na parte inferior da nota. Os atalhos de teclado continuam funcionando." checked={appearance.floatingToolbar} onChange={(floatingToolbar) => update({ floatingToolbar })} />
          <Toggle label="Corretor ortográfico" checked={appearance.spellcheck} onChange={(spellcheck) => update({ spellcheck })} />
        </>}

        {section === "indexing" && <>
          <h2>Indexação de anexos</h2>
          <p className="set-note">O texto de PDFs e imagens é extraído localmente para entrar na busca.</p>
          <div className="attachment-jobs" aria-label="Estado da indexação de anexos">
            <strong>Indexação local</strong>
            {jobs.length === 0 && <span className="set-empty">Nenhum anexo na fila de indexação.</span>}
            {jobs.slice(0, 20).map((j) => (
              <div key={j.id} className={j.status === "error" ? "job-error" : undefined}>
                <span title={j.error ?? j.status}>{j.fileName}: {jobText(j)}{j.status === "error" && j.error ? ` — ${j.error}` : ""}</span>
                {j.status === "error" && <button onClick={async () => { await client.retryAttachmentJob(j.id); await refreshJobs(); }}>Tentar novamente</button>}
                {["queued", "running"].includes(j.status) && <button onClick={async () => { await client.cancelAttachmentJob(j.id); await refreshJobs(); }}>Cancelar</button>}
              </div>
            ))}
          </div>
          <div className="set-actions"><button onClick={async () => { await client.reindexAttachments(); await refreshJobs(); }}>Reindexar anexos</button></div>
        </>}

        {section === "data" && <>
          <h2>Dados e backup</h2>
          <p className="set-note">Suas notas ficam em um banco SQLite local no perfil do aplicativo.</p>
          <Row label="Backup completo" hint="Notas, cadernos e anexos em um único arquivo."><button onClick={onSaveBackup}>Salvar backup</button><button onClick={onRestoreBackup}>Restaurar backup</button></Row>
          <Row label="Importar"><button onClick={onImportClick}>Markdown (.md)</button><button onClick={onImportEml}>E-mail (.eml)</button></Row>
        </>}

        {section === "clipper" && <>
          <h2>Web Clipper</h2>
          <p className="set-note">Guarde páginas da web neste app. A conexão local só funciona com o Caderno aberto.</p>
          <div className="set-actions"><button onClick={onClipper}>Gerenciar conexão do Clipper</button></div>
        </>}

        {section === "raycast" && <>
          <h2>Raycast</h2>
          <p className="set-note">Conexão local para buscar e abrir notas e criar notas e tarefas. A ponte escuta somente em 127.0.0.1:43188; o Clipper mantém seu próprio pareamento e suas regras de origem.</p>
          {raycastError && <p role="alert" className="set-note">{raycastError}</p>}
          {raycastStatus?.enabled && raycastStatus.paired && <p className="set-note">Pareado. A conexão autenticada volta a iniciar quando o Caderno abrir.</p>}
          {raycastStatus?.enabled && !raycastStatus.paired && <p className="set-note">Conexão ativa nesta sessão. Gere o código abaixo e informe-o no comando “Parear Caderno” do Raycast.</p>}
          {!raycastStatus?.enabled && <p className="set-note">Ative a conexão para parear. O pareamento é opcional e pode ser revogado aqui.</p>}
          <div className="set-actions">
            {!raycastStatus?.enabled
              ? <button onClick={() => void runRaycastAction("enable")} disabled={raycastBusy}>Ativar conexão local</button>
              : <button onClick={() => void runRaycastAction("pair")} disabled={raycastBusy}>{raycastStatus.paired ? "Gerar novo código de pareamento" : "Gerar código de pareamento"}</button>}
            {raycastStatus?.paired && <button onClick={() => void runRaycastAction("revoke")} disabled={raycastBusy}>Revogar acesso e desligar</button>}
          </div>
          {raycastCode && Date.now() < raycastCode.expiresAt && <div className="set-note">
            <label htmlFor="raycast-pair-code">Código válido por até três minutos (cinco tentativas)</label>
            <input id="raycast-pair-code" value={raycastCode.value} readOnly onFocus={event => event.currentTarget.select()} aria-label="Código de pareamento Raycast" />
          </div>}
        </>}

        {section === "log" && <>
          <h2>Avisos e erros</h2>
          <p className="set-note">Mensagens recentes do app. Elas aparecem rapidamente no topo e ficam registradas aqui.</p>
          <div className="log-list" role="log" aria-label="Registro de avisos e erros">
            {state.log.length === 0 && <span className="set-empty">Nenhum aviso ou erro nesta sessão.</span>}
            {state.log.map((l) => (
              <div key={l.id} className={`log-entry ${l.level}`}>
                <time>{new Date(l.at).toLocaleTimeString("pt-BR")}</time><span>{l.message}</span>
              </div>
            ))}
          </div>
          {state.log.length > 0 && <div className="set-actions"><button onClick={() => dispatch({ type: "clearLog" })}><Trash2 size={13} /> Limpar registro</button></div>}
        </>}

        {(section === "appearance" || section === "editor") && (
          <div className="set-actions footer"><button onClick={reset} disabled={JSON.stringify(appearance) === JSON.stringify(DEFAULT_APPEARANCE)}><RotateCcw size={13} /> Restaurar padrões de aparência</button></div>
        )}
      </div>
    </section>
  );
}
