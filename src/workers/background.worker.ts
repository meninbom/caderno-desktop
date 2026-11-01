import {renderBackgroundEffect,type BackgroundRenderRequest} from "../lib/background-effects";
const worker=self as unknown as {onmessage:((event:MessageEvent<BackgroundRenderRequest>)=>void)|null;postMessage:(message:unknown,transfer?:Transferable[])=>void};
worker.onmessage=({data})=>{try{const bitmap=renderBackgroundEffect(data.source,data.effect,data.size,data.intensity);worker.postMessage({id:data.id,bitmap},[bitmap]);}catch(error){worker.postMessage({id:data.id,error:error instanceof Error?error.message:String(error)});}finally{data.source.close();}};
