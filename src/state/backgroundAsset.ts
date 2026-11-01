import {useCallback,useEffect,useRef,useState} from "react";
export interface BackgroundAsset {blob:Blob;name:string}
async function assetStore<T>(mode:IDBTransactionMode,action:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T>{
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const req=indexedDB.open("caderno-personalization",1);req.onupgradeneeded=()=>req.result.createObjectStore("assets");req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(new Error("Não foi possível abrir o armazenamento de imagens."));});
  try{return await new Promise<T>((resolve,reject)=>{const tx=db.transaction("assets",mode),req=action(tx.objectStore("assets"));let result:T;req.onsuccess=()=>{result=req.result;};tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(new Error("Não foi possível salvar a imagem. O fundo anterior foi mantido."));});}finally{db.close();}
}
export async function prepareBackgroundImage(file:Blob):Promise<Blob>{
  if(!["image/png","image/jpeg","image/webp","image/gif"].includes(file.type))throw new Error("Escolha uma imagem PNG, JPG, WEBP ou GIF.");
  if(file.size>12*1024*1024)throw new Error("A imagem deve ter no máximo 12 MB.");
  let image:ImageBitmap;
  try{image=await createImageBitmap(file);}catch{throw new Error("Não foi possível ler esta imagem. Tente outro arquivo.");}
  try{
    if(image.width*image.height>40_000_000)throw new Error("A imagem é muito grande. Use até 40 megapixels.");
    const scale=Math.min(1,2560/Math.max(image.width,image.height)),canvas=document.createElement("canvas");
    canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
    const ctx=canvas.getContext("2d");if(!ctx)throw new Error("Não foi possível preparar a imagem.");ctx.drawImage(image,0,0,canvas.width,canvas.height);
    const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error("Não foi possível converter a imagem.")),"image/webp",.86));
    if(blob.size>3_500_000)throw new Error("A imagem convertida é muito grande. Escolha uma imagem menor.");return blob;
  }finally{image.close();}
}
export function blobToDataUrl(blob:Blob):Promise<string>{return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(new Error("Não foi possível exportar a imagem."));r.readAsDataURL(blob);});}
export function dataUrlToBlob(data:string){const [header,body]=data.split(","),bytes=Uint8Array.from(atob(body),char=>char.charCodeAt(0));return new Blob([bytes],{type:header.slice(5).split(";")[0]});}
export function useBackgroundAsset(){
  const [asset,setAsset]=useState<BackgroundAsset|null>(null),[url,setUrl]=useState<string|null>(null),[error,setError]=useState(""),[ready,setReady]=useState(false);
  const revision=useRef(0);
  useEffect(()=>{let active=true;const current=revision.current;void assetStore<BackgroundAsset|undefined>("readonly",s=>s.get("background")).then(value=>{if(active&&current===revision.current)setAsset(value??null);}).catch(e=>{if(active)setError((e as Error).message);}).finally(()=>{if(active)setReady(true);});return()=>{active=false;};},[]);
  useEffect(()=>{if(!asset){setUrl(null);return;}const objectUrl=URL.createObjectURL(asset.blob);setUrl(objectUrl);return()=>URL.revokeObjectURL(objectUrl);},[asset]);
  const save=useCallback(async(blob:Blob,name:string)=>{const prepared=await prepareBackgroundImage(blob),value={blob:prepared,name:name.slice(0,120)};await assetStore("readwrite",s=>s.put(value,"background"));revision.current++;setAsset(value);setError("");},[]);
  const remove=useCallback(async()=>{await assetStore("readwrite",s=>s.delete("background"));revision.current++;setAsset(null);setError("");},[]);
  return {asset,url,error,ready,save,remove};
}
export type BackgroundAssetState=ReturnType<typeof useBackgroundAsset>;
