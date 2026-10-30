import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = process.cwd();
const packageDir = process.argv[2] || process.env.CADERNO_PACKAGE_DIR || 'release';
const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'caderno-packaged-smoke-'));
const env = { ...process.env, CADERNO_USER_DATA: userData };
delete env.ELECTRON_RUN_AS_NODE;
let app;
const invoke=(page,channel,input=null)=>page.evaluate(async({channel,input})=>{const result=await window.cadernoDesktop.invoke(channel,input);if(!result.ok)throw new Error(`${channel}: ${result.error}`);return result.data;},{channel,input});
const waitUntil=async(fn,label,timeout=30000)=>{const end=Date.now()+timeout;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error(`Timeout aguardando ${label}`);};
try {
  app = await electron.launch({
    executablePath: path.join(root, packageDir, 'win-unpacked', 'Caderno.exe'),
    args: [], env, timeout: 30000,
  });
  const page = await app.firstWindow();
  await page.getByRole('button', { name: /^Notas\b/ }).waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Mais ações' }).click();
  await page.getByRole('menuitem', { name: 'Salvar backup' }).waitFor();
  await page.getByRole('menuitem',{name:'Web Clipper'}).click();
  const clipper=page.getByRole('dialog',{name:'Web Clipper'});
  await clipper.getByRole('button',{name:'Configurar Clipper'}).click();
  const bridge=await invoke(page,'clipper:status');
  if(!bridge.enabled||bridge.port!==43187)throw new Error('Ponte local não ativou em loopback no pacote');
  await clipper.getByRole('button',{name:'Desativar conexão local'}).click();
  await clipper.getByRole('status').filter({hasText:'Conexão desativada'}).waitFor();
  await clipper.getByRole('button',{name:'Fechar'}).click();
  await page.getByRole('button',{name:'Mais ações'}).click();
  await page.screenshot({ path: path.join(root, 'evidence', 'functional', `packaged-smoke-${(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version)}.png`) });
  const note=await invoke(page,'notes:create',{title:'Smoke OCR restart packaged',contentHtml:''});
  const pdf=fs.readFileSync(path.join(root,'tests','fixtures','media','ocr-cancel-24-pages.pdf'));
  const attachment=await invoke(page,'attachments:save',{noteId:note.id,name:'ocr-cancel-24-pages.pdf',dataBase64:pdf.toString('base64')});
  const job=await waitUntil(async()=>{const jobs=await invoke(page,'attachments:jobs');return jobs.find(item=>item.attachmentId===attachment.id&&item.status==='running');},'OCR Utility Process iniciar');
  const canceled=await invoke(page,'attachments:cancel-job',{id:job.id});if(!canceled)throw new Error('Não foi possível cancelar o job OCR do smoke');
  await waitUntil(async()=>{const jobs=await invoke(page,'attachments:jobs');return jobs.find(item=>item.id===job.id&&item.status==='cancel_requested');},'cancelamento OCR persistido');
  await app.close();app=null;
  app=await electron.launch({executablePath:path.join(root,packageDir,'win-unpacked','Caderno.exe'),args:[],env,timeout:30000});
  const restartedPage=await app.firstWindow();await restartedPage.getByRole('button',{name:/^Notas\b/}).waitFor({timeout:15000});
  const recovered=await waitUntil(async()=>{const jobs=await invoke(restartedPage,'attachments:jobs');const item=jobs.find(value=>value.id===job.id);return item&&['completed','error'].includes(item.status)?item:null;},'OCR retomar após restart empacotado',60000);
  if(recovered.status!=='completed')throw new Error(`OCR após restart empacotado terminou em erro: ${recovered.error}`);
  const matches=await invoke(restartedPage,'notes:list',{view:'all',query:'CANCEL PIPELINE type:attachment'});
  if(!matches.some(item=>item.id===note.id))throw new Error('OCR empacotado terminou sem resultado indexado após o restart');
  const lifecycle=fs.readFileSync(path.join(userData,'lifecycle.jsonl'),'utf8').split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
  if(lifecycle.some(item=>item.event==='uncaughtException'||item.event==='render-process-gone'))throw new Error('Falha de processo durante smoke OCR empacotado');
  console.log(JSON.stringify({ ok: true, title: await restartedPage.title(), userData, packageDir, ocr:{jobId:job.id,canceledBeforeRestart:true,recoveredStatus:recovered.status,matchingNotes:matches.length,workerExits:lifecycle.filter(item=>item.event==='attachment-worker-exit').map(item=>item.details.code)} }));
} finally {
  if (app) await app.close().catch(() => {});
}
