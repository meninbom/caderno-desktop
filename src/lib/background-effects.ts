export type BackgroundTreatment="none"|"graphic"|"pixel"|"ascii"|"halftone";
/** Runs in a worker; the fallback uses the same raster contract if workers are unavailable. */
export function renderBackgroundEffect(source:ImageBitmap,effect:BackgroundTreatment,size:number,intensity:number):ImageBitmap{
  const w=source.width,h=source.height,target=new OffscreenCanvas(w,h),ctx=target.getContext("2d")!;
  ctx.drawImage(source,0,0);if(effect==="none"||intensity===0)return target.transferToImageBitmap();
  const layer=new OffscreenCanvas(w,h),out=layer.getContext("2d")!;
  if(effect==="graphic"){
    out.drawImage(source,0,0);const data=out.getImageData(0,0,w,h);for(let i=0;i<data.data.length;i+=4)for(let j=0;j<3;j++)data.data[i+j]=Math.round(data.data[i+j]/64)*64;out.putImageData(data,0,0);
  }else{
    const cell=Math.max(4,Math.round(size)),columns=Math.max(1,Math.ceil(w/cell)),rows=Math.max(1,Math.ceil(h/cell));
    const small=new OffscreenCanvas(columns,rows),smallCtx=small.getContext("2d")!;smallCtx.drawImage(source,0,0,columns,rows);
    if(effect==="pixel"){out.imageSmoothingEnabled=false;out.drawImage(small,0,0,w,h);}
    else{const data=smallCtx.getImageData(0,0,columns,rows).data;out.fillStyle="#080d15";out.fillRect(0,0,w,h);out.textAlign="center";out.textBaseline="middle";out.font=`${cell}px Consolas, monospace`;const chars=" .:-=+*#%@";
      for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){const i=(y*columns+x)*4,r=data[i],g=data[i+1],b=data[i+2],lum=(r*.299+g*.587+b*.114)/255;out.fillStyle=`rgb(${Math.min(255,r+50)},${Math.min(255,g+50)},${Math.min(255,b+50)})`;
        if(effect==="ascii")out.fillText(chars[Math.min(chars.length-1,Math.max(1,Math.floor(lum*(chars.length-1))))],x*cell+cell/2,y*cell+cell/2);
        else{out.beginPath();out.arc(x*cell+cell/2,y*cell+cell/2,Math.max(.6,lum*cell*.55),0,Math.PI*2);out.fill();}
      }
    }
  }
  ctx.globalAlpha=intensity/100;ctx.drawImage(layer,0,0);return target.transferToImageBitmap();
}
export interface BackgroundRenderRequest {id:number;source:ImageBitmap;effect:BackgroundTreatment;size:number;intensity:number}
