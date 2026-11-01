import {memo,useEffect,useRef,useState} from "react";
import type {Appearance} from "../state/appearance";
import {renderBackgroundEffect,type BackgroundRenderRequest} from "../lib/background-effects";

function fitImage(ctx:CanvasRenderingContext2D,image:HTMLImageElement,w:number,h:number,fit:Appearance["backgroundFit"],x:number,y:number){
  if(fit==="tile"){const pattern=ctx.createPattern(image,"repeat");if(pattern){ctx.fillStyle=pattern;ctx.fillRect(0,0,w,h);}return;}
  const scale=fit==="contain"?Math.min(w/image.width,h/image.height):Math.max(w/image.width,h/image.height);
  const dw=image.width*scale,dh=image.height*scale;ctx.drawImage(image,(w-dw)*x/100,(h-dh)*y/100,dw,dh);
}
export const WorkspaceBackground=memo(function WorkspaceBackground({appearance:a,imageUrl,className=""}:{appearance:Appearance;imageUrl:string|null;className?:string}){
  const canvasRef=useRef<HTMLCanvasElement>(null);
  const {backgroundKind,backgroundColor,backgroundColorEnd,backgroundAngle,backgroundEffect,effectSize,effectIntensity,backgroundFit,backgroundPositionX,backgroundPositionY}=a;
  const [workerFailed,setWorkerFailed]=useState(false);
  const renderer=useRef<{send:(request:BackgroundRenderRequest)=>void}|null>(null),generation=useRef(0);
  const renderInfo=useRef({effect:backgroundEffect,kind:backgroundKind,imageLoaded:true});
  const markComplete=(canvas:HTMLCanvasElement)=>{canvas.dataset.effect=renderInfo.current.effect;canvas.dataset.kind=renderInfo.current.kind;canvas.dataset.imageLoaded=String(renderInfo.current.imageLoaded);canvas.dataset.ready="true";};
  const useWorker=backgroundKind!=="none"&&backgroundEffect!=="none"&&effectIntensity>0&&!workerFailed;
  useEffect(()=>{
    if(!useWorker)return;
    let worker:Worker;try{worker=new Worker(new URL("../workers/background.worker.ts",import.meta.url),{type:"module"});}catch{setWorkerFailed(true);return;}
    let busy=false,queued:BackgroundRenderRequest|null=null,disposed=false;
    const send=(request:BackgroundRenderRequest)=>{if(disposed){request.source.close();return;}if(busy){queued?.source.close();queued=request;return;}busy=true;worker.postMessage(request,[request.source]);};
    renderer.current={send};
    worker.onmessage=({data}:{data:{id:number;bitmap?:ImageBitmap;error?:string}})=>{
      busy=false;if(data.error){setWorkerFailed(true);return;}
      const canvas=canvasRef.current;
      if(data.bitmap){if(!queued&&canvas&&data.id===generation.current){if(canvas.width!==data.bitmap.width)canvas.width=data.bitmap.width;if(canvas.height!==data.bitmap.height)canvas.height=data.bitmap.height;const ctx=canvas.getContext("2d")!;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(data.bitmap,0,0);canvas.dataset.renderer="worker";markComplete(canvas);}data.bitmap.close();}
      if(queued){const request=queued;queued=null;send(request);}
    };
    worker.onerror=()=>setWorkerFailed(true);
    return()=>{disposed=true;queued?.source.close();worker.terminate();renderer.current=null;};
  },[useWorker]);
  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas||!canvas.parentElement)return;const parent=canvas.parentElement;
    canvas.dataset.ready="false";
    let stopped=false,timer:ReturnType<typeof setTimeout>|undefined;const image=backgroundKind==="image"&&imageUrl?new Image():null;let loaded=false;
    const render=()=>{
      if(stopped)return;const generationId=++generation.current;const bounds=parent.getBoundingClientRect(),scale=Math.min(1.25,1920/Math.max(1,bounds.width));
      renderInfo.current={effect:backgroundEffect,kind:backgroundKind,imageLoaded:backgroundKind!=="image"||loaded};canvas.dataset.ready="false";
      const w=Math.max(1,Math.round(bounds.width*scale)),h=Math.max(1,Math.round(bounds.height*scale));
      const source=document.createElement("canvas");source.width=w;source.height=h;const ctx=source.getContext("2d")!;
      ctx.fillStyle=backgroundColor;ctx.fillRect(0,0,w,h);
      if(backgroundKind==="gradient"){
        const rad=backgroundAngle*Math.PI/180,dx=Math.sin(rad)*w/2,dy=-Math.cos(rad)*h/2;
        const gradient=ctx.createLinearGradient(w/2-dx,h/2-dy,w/2+dx,h/2+dy);gradient.addColorStop(0,backgroundColor);gradient.addColorStop(1,backgroundColorEnd);ctx.fillStyle=gradient;ctx.fillRect(0,0,w,h);
        const glow=ctx.createRadialGradient(w*.27,h*.23,0,w*.35,h*.35,w*.65);glow.addColorStop(0,"#ffffff17");glow.addColorStop(1,"#ffffff00");ctx.fillStyle=glow;ctx.fillRect(0,0,w,h);
      }
      if(backgroundKind==="image"&&image&&loaded)fitImage(ctx,image,w,h,backgroundFit,backgroundPositionX,backgroundPositionY);
      const target=canvas.getContext("2d")!;
      if(backgroundEffect==="none"||effectIntensity===0){canvas.width=w;canvas.height=h;target.drawImage(source,0,0);canvas.dataset.renderer="direct";markComplete(canvas);return;}
      void createImageBitmap(source).then(bitmap=>{
        if(stopped||generationId!==generation.current){bitmap.close();return;}
        if(renderer.current)renderer.current.send({id:generationId,source:bitmap,effect:backgroundEffect,size:effectSize*scale,intensity:effectIntensity});
        else{const result=renderBackgroundEffect(bitmap,backgroundEffect,effectSize*scale,effectIntensity);canvas.width=w;canvas.height=h;target.drawImage(result,0,0);bitmap.close();result.close();canvas.dataset.renderer="fallback";markComplete(canvas);}
      });
    };
    if(image){image.onload=()=>{loaded=true;render();};image.src=imageUrl!;}
    const schedule=()=>{clearTimeout(timer);if(!document.hidden)timer=setTimeout(render,60);};
    const observer=new ResizeObserver(schedule);observer.observe(parent);document.addEventListener("visibilitychange",schedule);schedule();
    return()=>{stopped=true;++generation.current;clearTimeout(timer);observer.disconnect();document.removeEventListener("visibilitychange",schedule);if(image)image.onload=null;};
  },[imageUrl,backgroundKind,backgroundColor,backgroundColorEnd,backgroundAngle,backgroundEffect,effectSize,effectIntensity,backgroundFit,backgroundPositionX,backgroundPositionY,workerFailed]);
  if(a.backgroundKind==="none")return null;
  return <div className={`workspace-background ${className}`} aria-hidden="true">
    <canvas ref={canvasRef} style={{filter:`blur(${a.backgroundBlur}px) saturate(${a.backgroundSaturation}%) brightness(${1-a.backgroundDim/100})`,transform:a.backgroundBlur?"scale(1.08)":undefined}}/>
    <div className={`background-pattern pattern-${a.backgroundPattern}`} style={{opacity:a.patternOpacity/100}}/>
  </div>;
});
