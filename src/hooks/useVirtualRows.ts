import {useLayoutEffect,useMemo,useRef,useState} from "react";
import {rowAtOffset,rowOffsets} from "../../shared/virtual-list";
/** Variable-height windowing; observers exist only for the rows currently on screen. */
export function useVirtualRows(items:readonly {id:string}[],scope:string){
  const scrollRef=useRef<HTMLDivElement>(null),sizes=useRef(new Map<string,number>());
  const [viewport,setViewport]=useState({top:0,height:600}),[revision,setRevision]=useState(0);
  const observer=useRef<ResizeObserver|null>(null),elements=useRef(new Map<string,HTMLElement>()),callbacks=useRef(new Map<string,(element:HTMLElement|null)=>void>());
  const revisionFrame=useRef(0),enabled=items.length>100;
  const measure=(element:HTMLElement)=>{const id=element.dataset.noteId;if(!id)return;const style=getComputedStyle(element),height=element.getBoundingClientRect().height+parseFloat(style.marginTop)+parseFloat(style.marginBottom)+1;
    if(height>0&&Math.abs((sizes.current.get(id)??0)-height)>.5){sizes.current.set(id,height);if(!revisionFrame.current)revisionFrame.current=requestAnimationFrame(()=>{revisionFrame.current=0;setRevision(x=>x+1);});}
  };
  useLayoutEffect(()=>{
    const node=scrollRef.current;if(!node)return;let frame=0;
    const refresh=()=>{if(frame)return;frame=requestAnimationFrame(()=>{frame=0;setViewport(old=>old.top===node.scrollTop&&old.height===node.clientHeight?old:{top:node.scrollTop,height:node.clientHeight});});};
    const resize=new ResizeObserver(refresh);resize.observe(node);node.addEventListener("scroll",refresh,{passive:true});refresh();
    observer.current=new ResizeObserver(entries=>{for(const entry of entries)measure(entry.target as HTMLElement);});
    for(const element of elements.current.values())observer.current.observe(element);
    return()=>{resize.disconnect();node.removeEventListener("scroll",refresh);observer.current?.disconnect();observer.current=null;cancelAnimationFrame(frame);cancelAnimationFrame(revisionFrame.current);revisionFrame.current=0;};
  },[]);
  useLayoutEffect(()=>{if(scrollRef.current)scrollRef.current.scrollTop=0;setViewport(old=>old.top===0?old:{...old,top:0});},[scope]);
  const offsets=useMemo(()=>rowOffsets(items.map(item=>item.id),sizes.current,110),[items,revision]);
  const start=enabled?Math.max(0,rowAtOffset(offsets,viewport.top)-6):0;
  const end=enabled?Math.min(items.length,rowAtOffset(offsets,viewport.top+viewport.height)+7):items.length;
  const measureRef=(id:string)=>{
    if(!callbacks.current.has(id))callbacks.current.set(id,element=>{const previous=elements.current.get(id);if(previous)observer.current?.unobserve(previous);if(element){elements.current.set(id,element);observer.current?.observe(element);measure(element);}else elements.current.delete(id);});
    return callbacks.current.get(id)!;
  };
  return {scrollRef,start,end,paddingTop:enabled?offsets[start]+6:6,paddingBottom:enabled?offsets[items.length]-offsets[end]+16:16,measureRef};
}
