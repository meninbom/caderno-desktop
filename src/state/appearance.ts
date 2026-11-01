import {useCallback,useEffect,useState} from "react";
import {DEFAULT_APPEARANCE,normalizeAppearance,type Appearance} from "../../shared/appearance";
export {DEFAULT_APPEARANCE,ACCENT_PRESETS,APPEARANCE_PRESETS,normalizeAppearance,presetAppearance} from "../../shared/appearance";
export type {Appearance} from "../../shared/appearance";
const KEY="caderno.appearance.v1";
const FONTS={sans:'"DM Sans", "Segoe UI", system-ui, sans-serif',serif:'Georgia, "Iowan Old Style", "Times New Roman", serif',mono:"var(--font-mono)"};
function load():Appearance{try{return normalizeAppearance(JSON.parse(localStorage.getItem(KEY)??"{}"));}catch{return {...DEFAULT_APPEARANCE};}}
const PALETTES={
  slate:{light:["#f4f7fb","#f1f4f9","#ffffff","#e9eef6","#d8e0ec","#e2e8f1","#23314a","#60708a","#78859b"],dark:["#111924","#15202e","#182434","#243247","#344256","#293749","#eef3fc","#a5b4ca","#8393ac"]},
  warm:{light:["#f6f2eb","#f1ece3","#fffcf5","#eae3d6","#d9d0c0","#e5ddcf","#393329","#7b7060","#948778"],dark:["#1b1916","#211e19","#27231e","#343027","#494137","#383229","#f3ece0","#b7aa94","#958973"]},
};
const paletteKeys=["--bg","--bg-soft","--surface","--surface-2","--border","--border-soft","--text","--text-muted","--text-faint"];
export function applyAppearance(a:Appearance){
  const root=document.documentElement,s=root.style;
  const set=(key:string,value:string|null)=>value===null?s.removeProperty(key):s.setProperty(key,value);
  const theme=root.dataset.theme==="dark"?"dark":"light";
  const colors=a.surfaceTone==="neutral"?null:PALETTES[a.surfaceTone][theme];
  paletteKeys.forEach((key,i)=>set(key,colors?.[i]??null));
  if(a.surfaceColor){set("--surface",a.surfaceColor);set("--bg-soft",a.surfaceColor);set("--surface-2",`color-mix(in srgb, ${a.surfaceColor} 88%, ${theme==="dark"?"white":"black"})`);set("--border",`color-mix(in srgb, ${a.surfaceColor} 75%, ${theme==="dark"?"white":"black"})`);set("--border-soft",`color-mix(in srgb, ${a.surfaceColor} 87%, ${theme==="dark"?"white":"black"})`);}
  if(a.textColor){set("--text",a.textColor);set("--text-muted",`color-mix(in srgb, ${a.textColor} 72%, var(--surface))`);set("--text-faint",`color-mix(in srgb, ${a.textColor} 58%, var(--surface))`);}
  set("--accent",a.accent);set("--accent-hover",a.accent&&`color-mix(in srgb, ${a.accent} 82%, black)`);
  set("--accent-soft",a.accent&&`color-mix(in srgb, ${a.accent} 14%, var(--surface))`);
  set("--accent-soft-strong",a.accent&&`color-mix(in srgb, ${a.accent} 23%, var(--surface))`);
  if(a.accent){const [r,g,b]=a.accent.slice(1).match(/../g)!.map(v=>parseInt(v,16));set("--accent-text",r*.299+g*.587+b*.114>155?"#15191f":"#ffffff");}else set("--accent-text",null);
  s.setProperty("--font-sans",a.uiFont==="dm"?'"DM Sans", "Segoe UI", system-ui, sans-serif':a.uiFont==="mono"?"var(--font-mono)":'"Segoe UI", system-ui, sans-serif');
  const props:Record<string,string>={"--editor-font":FONTS[a.editorFont],"--editor-size":"15.5px","--editor-zoom":String(a.editorZoom/100),"--ui-size":`${a.uiSize}px`,"--editor-line":String(a.lineHeight),"--editor-gap":`${a.paragraphGap}em`,"--editor-width":a.fullWidth?"none":`${a.contentWidth+a.editorGutter*2}px`,"--editor-gutter":`${a.editorGutter}px`,"--sidebar-w":`${a.sidebarWidth}px`,"--list-w":`${a.listWidth}px`,"--float-radius":`${a.panelRadius}px`,"--float-inset":`${a.panelGap}px`,"--float-gap":`${a.panelGap}px`,"--panel-opacity":`${a.panelOpacity}%`,"--editor-opacity":`${a.editorOpacity}%`,"--panel-blur":`${a.panelBlur}px`,"--panel-shadow":String(a.panelShadow/100),"--border-strength":`${a.borderStrength}%`};
  Object.entries(props).forEach(([k,v])=>s.setProperty(k,v));root.dataset.density=a.density;
  root.toggleAttribute("data-custom-background",a.backgroundKind!=="none");root.toggleAttribute("data-reduced-motion",a.reducedMotion);
  root.toggleAttribute("data-toolbar-hidden",!a.floatingToolbar);root.toggleAttribute("data-no-spellcheck",!a.spellcheck);
  root.toggleAttribute("data-sidebar-collapsed",a.sidebarCollapsed);root.toggleAttribute("data-list-collapsed",a.listCollapsed);
  document.querySelectorAll(".ProseMirror, .title-input").forEach(el=>el.setAttribute("spellcheck",String(a.spellcheck)));
}
export function useAppearance(){
  const [appearance,setAppearance]=useState<Appearance>(load),[saveError,setSaveError]=useState("");
  useEffect(()=>{applyAppearance(appearance);try{localStorage.setItem(KEY,JSON.stringify(appearance));setSaveError("");}catch{setSaveError("Não foi possível salvar a aparência neste dispositivo.");}
    const observer=new MutationObserver(()=>applyAppearance(appearance));observer.observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});return()=>observer.disconnect();
  },[appearance]);
  const update=useCallback((patch:Partial<Appearance>)=>setAppearance(a=>normalizeAppearance({...a,...patch})),[]);
  const reset=useCallback(()=>setAppearance({...DEFAULT_APPEARANCE}),[]);
  return {appearance,update,reset,saveError};
}
