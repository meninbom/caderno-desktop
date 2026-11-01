import {useCallback,useEffect,useRef,useState} from "react";
import type {AttachmentJob} from "../../shared/ipc";
import {client} from "../api/client";
/** Event-driven progress: idle workspaces perform no polling or full-shell repaint. */
export function useAttachmentJobs(){
  const [jobs,setJobs]=useState<AttachmentJob[]>([]);
  const sequence=useRef(0);
  const refreshJobs=useCallback(async()=>{
    const current=++sequence.current;
    try{const value=await client.listAttachmentJobs();if(current===sequence.current)setJobs(old=>JSON.stringify(old)===JSON.stringify(value)?old:value);}catch{/* The indexing panel reports individual job errors. */}
  },[]);
  useEffect(()=>{
    let timer:ReturnType<typeof setTimeout>|undefined;
    const schedule=()=>{if(document.hidden)return;clearTimeout(timer);timer=setTimeout(()=>void refreshJobs(),100);};
    const visible=()=>{if(!document.hidden)schedule();};
    void refreshJobs();
    const unsubscribe=window.cadernoDesktop?.onAttachmentJobsChanged?.(schedule);
    window.addEventListener("focus",schedule);document.addEventListener("visibilitychange",visible);
    return()=>{clearTimeout(timer);unsubscribe?.();window.removeEventListener("focus",schedule);document.removeEventListener("visibilitychange",visible);sequence.current++;};
  },[refreshJobs]);
  return {jobs,refreshJobs};
}
