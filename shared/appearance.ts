export interface Appearance {
  accent: string | null; surfaceColor: string | null; textColor: string | null; editorFont: "sans" | "serif" | "mono";
  editorZoom: number; uiSize: number; lineHeight: number; paragraphGap: number;
  contentWidth: number; fullWidth: boolean; editorGutter: number;
  sidebarWidth: number; listWidth: number; floatingToolbar: boolean; spellcheck: boolean;
  sidebarCollapsed: boolean; listCollapsed: boolean;
  uiFont: "system" | "dm" | "mono"; density: "comfortable" | "compact"; surfaceTone: "neutral" | "slate" | "warm";
  panelOpacity: number; panelBlur: number; panelRadius: number; panelShadow: number; panelGap: number;
  editorOpacity: number; borderStrength: number; reducedMotion: boolean;
  backgroundKind: "none" | "solid" | "gradient" | "image"; backgroundColor: string; backgroundColorEnd: string;
  backgroundAngle: number; backgroundEffect: "none" | "graphic" | "pixel" | "ascii" | "halftone";
  effectSize: number; effectIntensity: number; backgroundBlur: number; backgroundDim: number; backgroundSaturation: number;
  backgroundFit: "cover" | "contain" | "tile"; backgroundPositionX: number; backgroundPositionY: number;
  backgroundPattern: "none" | "dots" | "grid" | "lines"; patternOpacity: number;
}
export const DEFAULT_APPEARANCE: Appearance = {
  accent: null, surfaceColor: null, textColor: null, editorFont: "sans", editorZoom: 100, uiSize: 13, lineHeight: 1.7,
  paragraphGap: .65, contentWidth: 900, fullWidth: false, editorGutter: 32,
  sidebarWidth: 224, listWidth: 280, floatingToolbar: true, spellcheck: true,
  sidebarCollapsed: false, listCollapsed: false, uiFont: "dm", density: "comfortable", surfaceTone: "neutral",
  panelOpacity: 96, panelBlur: 18, panelRadius: 20, panelShadow: 35, panelGap: 12,
  editorOpacity: 96, borderStrength: 35, reducedMotion: false,
  backgroundKind: "none", backgroundColor: "#102b43", backgroundColorEnd: "#285b56", backgroundAngle: 135,
  backgroundEffect: "none", effectSize: 12, effectIntensity: 80, backgroundBlur: 0, backgroundDim: 20,
  backgroundSaturation: 100, backgroundFit: "cover", backgroundPositionX: 50, backgroundPositionY: 50,
  backgroundPattern: "none", patternOpacity: 12,
};
export const ACCENT_PRESETS: {name:string;value:string|null}[] = [
  {name:"Azul (padrão)",value:null},{name:"Índigo",value:"#6366f1"},{name:"Violeta",value:"#9b8ef4"},
  {name:"Rosa",value:"#db2777"},{name:"Vermelho",value:"#dc2626"},{name:"Laranja",value:"#ea580c"},
  {name:"Verde",value:"#16a34a"},{name:"Turquesa",value:"#0d9488"},{name:"Grafite",value:"#52525b"},
];
export const APPEARANCE_PRESETS: {id:string;name:string;description:string;theme:"light"|"dark";colors:[string,string];patch:Partial<Appearance>}[] = [
  {id:"essential",name:"Essencial",description:"Clareza para o dia a dia",theme:"light",colors:["#f7f8fb","#e3e9f2"],patch:{backgroundKind:"none",accent:null}},
  {id:"breeze",name:"Brisa",description:"Azul e verde, sem pressa",theme:"dark",colors:["#102b43","#285b56"],patch:{backgroundKind:"gradient",accent:"#8ecfc2",surfaceTone:"slate",panelOpacity:82,editorOpacity:82,backgroundDim:10,backgroundPattern:"dots"}},
  {id:"aurora",name:"Aurora",description:"Uma dose de cor",theme:"dark",colors:["#24205a","#873e65"],patch:{backgroundKind:"gradient",backgroundColor:"#24205a",backgroundColorEnd:"#873e65",accent:"#b4a5ff",panelOpacity:80,editorOpacity:85,backgroundPattern:"dots",backgroundDim:10}},
  {id:"paper",name:"Papel",description:"Luz suave, tons naturais",theme:"light",colors:["#eae0d0","#c4b39a"],patch:{backgroundKind:"gradient",backgroundColor:"#eae0d0",backgroundColorEnd:"#c4b39a",surfaceTone:"warm",accent:"#8a5832",panelOpacity:92,editorOpacity:94,backgroundDim:0,editorFont:"serif"}},
  {id:"terminal",name:"Terminal",description:"Texto, textura e contraste",theme:"dark",colors:["#061a14","#204c3b"],patch:{backgroundKind:"gradient",backgroundColor:"#061a14",backgroundColorEnd:"#204c3b",backgroundEffect:"ascii",effectSize:14,effectIntensity:65,accent:"#8bd1a3",uiFont:"mono",panelOpacity:88,editorOpacity:88,editorFont:"mono",panelRadius:10}},
  {id:"night",name:"Noite",description:"Foco quando tudo desacelera",theme:"dark",colors:["#080e22","#1e3159"],patch:{backgroundKind:"gradient",backgroundColor:"#080e22",backgroundColorEnd:"#1e3159",surfaceTone:"slate",accent:"#9aaef8",panelOpacity:90,editorOpacity:92,backgroundPattern:"dots",backgroundDim:15}},
];
const ranges: Partial<Record<keyof Appearance,[number,number]>> = {
  editorZoom:[50,200],uiSize:[12,16],lineHeight:[1.3,2.2],paragraphGap:[0,1.5],contentWidth:[320,2400],editorGutter:[12,160],sidebarWidth:[190,320],listWidth:[230,420],panelOpacity:[45,100],panelBlur:[0,32],panelRadius:[0,28],panelShadow:[0,100],panelGap:[6,24],editorOpacity:[45,100],borderStrength:[0,100],backgroundAngle:[0,360],effectSize:[4,32],effectIntensity:[0,100],backgroundBlur:[0,24],backgroundDim:[0,85],backgroundSaturation:[0,180],backgroundPositionX:[0,100],backgroundPositionY:[0,100],patternOpacity:[0,45],
};
const choices: Partial<Record<keyof Appearance,readonly string[]>> = {
  editorFont:["sans","serif","mono"],uiFont:["system","dm","mono"],density:["comfortable","compact"],surfaceTone:["neutral","slate","warm"],backgroundKind:["none","solid","gradient","image"],backgroundEffect:["none","graphic","pixel","ascii","halftone"],backgroundFit:["cover","contain","tile"],backgroundPattern:["none","dots","grid","lines"],
};
export function normalizeAppearance(value: unknown): Appearance {
  const raw=value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
  const out:Record<string,unknown>={...DEFAULT_APPEARANCE};
  for(const key of Object.keys(DEFAULT_APPEARANCE) as (keyof Appearance)[]){
    const v=raw[key],fallback=DEFAULT_APPEARANCE[key],range=ranges[key],allowed=choices[key];
    if(range)out[key]=typeof v==="number"&&Number.isFinite(v)?Math.min(range[1],Math.max(range[0],v)):fallback;
    else if(allowed)out[key]=typeof v==="string"&&allowed.includes(v)?v:fallback;
    else if(typeof fallback==="boolean")out[key]=typeof v==="boolean"?v:fallback;
    else if(key==="accent"||key==="surfaceColor"||key==="textColor"||key==="backgroundColor"||key==="backgroundColorEnd")out[key]=typeof v==="string"&&/^#[\da-f]{6}$/i.test(v)?v:fallback;
  }
  return out as unknown as Appearance;
}
export function presetAppearance(preset:typeof APPEARANCE_PRESETS[number],current:Appearance):Appearance {
  return normalizeAppearance({...DEFAULT_APPEARANCE,...preset.patch,sidebarCollapsed:current.sidebarCollapsed,listCollapsed:current.listCollapsed,sidebarWidth:current.sidebarWidth,listWidth:current.listWidth,editorZoom:current.editorZoom,spellcheck:current.spellcheck});
}
export function exportAppearance(appearance:Appearance,theme:"light"|"dark",image:string|null,imageName:string){
  return JSON.stringify({format:"caderno-appearance",version:1,theme,appearance,image,imageName},null,2);
}
export function parseAppearance(text:string){
  if(text.length>6_000_000)throw new Error("O tema deve ter no máximo 6 MB.");
  const data=JSON.parse(text) as Record<string,unknown>;
  if(!data||data.format!=="caderno-appearance"||data.version!==1||!data.appearance||typeof data.appearance!=="object"||Array.isArray(data.appearance))throw new Error("Este arquivo não é um tema do Caderno compatível.");
  if(data.image!=null&&(typeof data.image!=="string"||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(data.image)))throw new Error("A imagem do tema não é válida.");
  return {appearance:normalizeAppearance(data.appearance),theme:data.theme==="dark"?"dark" as const:"light" as const,image:typeof data.image==="string"?data.image:null,imageName:typeof data.imageName==="string"?data.imageName.slice(0,120):"Fundo importado"};
}
