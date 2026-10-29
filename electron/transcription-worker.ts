import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { readWhisperOutput } from "./transcription-output";

const parentPort=(process as NodeJS.Process & {parentPort?:Electron.ParentPort}).parentPort;
let child:ChildProcess|null=null,canceled=false;
const MAX_BYTES=50*1024*1024,MAX_DURATION=2*60*60*1000,TIMEOUT=30*60*1000;
if(!parentPort)process.exit(1);else parentPort.postMessage({status:"ready"});
parentPort?.on("message",(event:Electron.MessageEvent)=>{
  const msg=event.data as {id:string;audioPath:string;fileName:string;jobDir:string;runtime:string;ffmpeg:string;language:"pt"|"auto";timeout?:number;cancel?:boolean};
  if(msg.cancel){canceled=true;killTree(child);return;}
  void run(msg).catch(error=>send({id:msg.id,status:"failed",error:error instanceof Error?error.message:String(error)})).finally(()=>send({id:msg.id,status:"idle"}));
});
function send(value:unknown){parentPort?.postMessage(value);}
async function run(m:{id:string;audioPath:string;fileName:string;jobDir:string;runtime:string;ffmpeg:string;language:"pt"|"auto";timeout?:number}):Promise<void>{
  try{
    const audio=fs.realpathSync(m.audioPath),stat=fs.statSync(audio);if(!stat.isFile()||!stat.size)throw new Error("O áudio está vazio ou não é um arquivo regular.");if(stat.size>MAX_BYTES)throw new Error("Áudio acima do limite local de 50 MB.");
    const runtime=fs.realpathSync(m.runtime),cli=path.join(runtime,"whisper-cli.exe"),model=path.join(runtime,"models","ggml-tiny.bin"),ffmpeg=fs.realpathSync(m.ffmpeg);
    if(!fs.existsSync(cli))throw new Error("Mecanismo whisper-cli.exe ausente no runtime configurado.");if(!fs.existsSync(model)||fs.statSync(model).size<50_000_000)throw new Error("Modelo tiny ausente ou inválido. Confira a configuração local do mecanismo.");if(!fs.existsSync(ffmpeg))throw new Error("FFmpeg não encontrado no PATH/configuração local.");
    const stage=path.resolve(m.jobDir),relativeStage=path.relative(runtime,stage);if(!relativeStage||relativeStage.startsWith("..")||path.isAbsolute(relativeStage)||!/^[A-Za-z0-9_\\-]+(?:[\\/][A-Za-z0-9_\\-]+)*$/.test(relativeStage))throw new Error("Pasta temporária de transcrição inválida.");fs.mkdirSync(stage,{recursive:true});const wav=path.join(relativeStage,"audio.wav"),out=path.join(relativeStage,"transcript");
    send({id:m.id,status:"converting",progress:4,stage:"Convertendo áudio localmente"});
    await launch(ffmpeg,["-nostdin","-hide_banner","-loglevel","error","-y","-i",audio,"-vn","-ac","1","-ar","16000","-c:a","pcm_s16le",wav],runtime,120000);
    if(canceled)throw new Error("__CANCELED__");const wavStat=fs.statSync(path.join(runtime,wav)),durationMs=Math.floor(wavStat.size/32000*1000);if(durationMs<=0)throw new Error("O arquivo não contém áudio decodificável.");if(durationMs>MAX_DURATION)throw new Error("Áudio acima do limite local de 2 horas.");
    send({id:m.id,status:"transcribing",progress:20,stage:"Transcrevendo no dispositivo"});
    const args=["-m",".\\models\\ggml-tiny.bin","-f",wav,"-l",m.language==="pt"?"pt":"auto","-t",String(Math.max(1,Math.min(4,require("node:os").cpus().length-1))),"-ng","-ojf","-of",out];
    const stdout=await launch(cli,args,runtime,m.timeout??TIMEOUT,()=>send({id:m.id,status:"transcribing",progress:65,stage:"Executando modelo local"}));
    if(canceled)throw new Error("__CANCELED__");const jsonPath=path.join(stage, "transcript.json"),result=readWhisperOutput(jsonPath,stdout,m.language);
    send({id:m.id,status:"completed",progress:100,stage:"Concluído",...result,durationMs});
  }catch(error){const message=error instanceof Error?error.message:String(error);send({id:m.id,status:message==="__CANCELED__"||canceled?"canceled":"failed",error:message==="__CANCELED__"?"Transcrição cancelada.":message});}
  finally{try{fs.rmSync(m.jobDir,{recursive:true,force:true});}catch{}}
}
function killTree(proc:ChildProcess|null){if(!proc)return;try{proc.kill();}catch{}if(process.platform==="win32"&&proc.pid){const killer=spawn(path.join(process.env.WINDIR??"C:\\Windows","System32","taskkill.exe"),["/PID",String(proc.pid),"/T","/F"],{windowsHide:true,shell:false,stdio:"ignore"});killer.unref();}}
function launch(file:string,args:string[],cwd:string,timeout:number,onStart?:()=>void):Promise<string>{return new Promise((resolve,reject)=>{let out="",err="",settled=false;const p=spawn(file,args,{cwd,windowsHide:true,shell:false,stdio:["ignore","pipe","pipe"]});child=p;const done=(e?:Error)=>{if(settled)return;settled=true;if(child===p)child=null;if(e)reject(e);else resolve(out);};const watchdog=setTimeout(()=>{killTree(p);done(new Error("A operação excedeu o limite de tempo local."));},timeout);watchdog.unref();p.stdout.on("data",(b:Buffer)=>{out=(out+b.toString("utf8")).slice(-12000);onStart?.();});p.stderr.on("data",(b:Buffer)=>{err=(err+b.toString("utf8")).slice(-4000);});p.once("error",e=>{clearTimeout(watchdog);done(new Error(`Não foi possível iniciar ${path.basename(file)}: ${e.message}`));});p.once("close",code=>{clearTimeout(watchdog);if(canceled)done(new Error("__CANCELED__"));else if(code!==0)done(new Error(`${path.basename(file)} encerrou com código ${code}${err?`: ${err.trim().slice(-1000)}`:"."}`));else done();});});}
