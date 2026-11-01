import {_electron as electron} from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),root=process.cwd();
const args=process.argv.slice(2),option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const size=Number(option('--notes','1000')),label=option('--label','measurement');
const runDir=fs.mkdtempSync(path.join(os.tmpdir(),'caderno-benchmark-'));
const output=option('--output',path.join(runDir,`${label}.json`));
const env={...process.env,CADERNO_USER_DATA:path.join(runDir,'profile'),CADERNO_QA_IPC:'1'};delete env.ELECTRON_RUN_AS_NODE;
let app,page;const errors=[];
const invoke=(channel,input=null)=>page.evaluate(async({channel,input})=>{const result=await window.cadernoDesktop.invoke(channel,input);if(!result.ok)throw new Error(result.error);return result.data;},{channel,input});
const launch=async()=>{const start=performance.now();app=await electron.launch({executablePath:require('electron'),args:[root],env});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.locator('.sidebar').waitFor();return start;};
const ready=async()=>{await page.waitForFunction(count=>document.querySelector('.notelist-header .count')?.textContent?.trim()===String(count),size);await page.locator('.note-row').first().waitFor();await page.waitForTimeout(250);};
const metrics=async cdp=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
const diff=(before,after)=>Object.fromEntries(Object.keys(after).filter(k=>k!=='app:qa-ipc-counts'&&(after[k]??0)-(before[k]??0)).map(k=>[k,(after[k]??0)-(before[k]??0)]));
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))]??0;
try{
  await launch();console.log(`Seeding ${size} local notes in isolated profile`);
  await page.evaluate(async count=>{const call=async(channel,input)=>{const r=await window.cadernoDesktop.invoke(channel,input);if(!r.ok)throw new Error(r.error);return r.data;};const nb=await call('notebooks:create',{name:'Benchmark'});for(let i=0;i<count;i++)await call('notes:create',{notebookId:nb.id,title:`Performance ${String(i).padStart(4,'0')}`,contentHtml:`<p>Uma nota de trabalho para medir navegação, busca e edição sem usar dados pessoais. Item ${i}.</p><p>${'Conteúdo de referência para o caderno. '.repeat(6)}</p>`});},size);
  await app.close();const startups=[];
  for(let i=0;i<3;i++){const start=await launch();await ready();startups.push(Math.round(performance.now()-start));if(i<2)await app.close();}
  const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');await cdp.send('HeapProfiler.collectGarbage');
  const initial=await metrics(cdp),idleBefore=await invoke('app:qa-ipc-counts');await page.waitForTimeout(6000);const idleAfter=await invoke('app:qa-ipc-counts'),idleMetrics=await metrics(cdp);
  await page.evaluate(()=>{window.__inputFrames=[];window.__longTasks=[];document.addEventListener('input',()=>{const start=performance.now();requestAnimationFrame(()=>window.__inputFrames.push(performance.now()-start));},true);new PerformanceObserver(list=>window.__longTasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask',buffered:false});});
  const search=page.getByRole('searchbox',{name:'Buscar notas',exact:true}),searchBefore=await invoke('app:qa-ipc-counts');
  const query=`Performance ${String(size-1).padStart(4,'0')}`;let lastInput;
  await search.click();await search.pressSequentially(query,{delay:25});lastInput=performance.now();
  await page.waitForFunction(title=>{const rows=document.querySelectorAll('.note-row');return rows.length===1&&rows[0].textContent.includes(title);},query);const searchSettle=Math.round(performance.now()-lastInput),searchAfter=await invoke('app:qa-ipc-counts');
  const searchFrames=await page.evaluate(()=>window.__inputFrames.splice(0));
  await search.fill('');await ready();await page.locator('.note-row').filter({hasText:query}).first().click();await page.locator('.tiptap').click();await page.keyboard.press('Control+End');
  const editBefore=await invoke('app:qa-ipc-counts'),editStart=performance.now();
  await page.keyboard.type(' Digitação responsiva com autosave.',{delay:22});await page.waitForTimeout(900);
  await page.keyboard.type(' Segunda frase sem bloquear a interface.',{delay:22});await page.waitForTimeout(1000);
  const editAfter=await invoke('app:qa-ipc-counts');await cdp.send('HeapProfiler.collectGarbage');
  const final=await metrics(cdp),inputFrames=await page.evaluate(()=>window.__inputFrames),longTasks=await page.evaluate(()=>window.__longTasks);
  const result={label,notes:size,viewport:{width:1200,height:780},platform:process.platform,cpu:os.cpus()[0]?.model,appVersion:(await invoke('app:meta')).version,artifacts:runDir,
    startupMs:{runs:startups,median:percentile(startups,.5)},
    idle:{durationMs:6000,ipc:diff(idleBefore,idleAfter),rendererTaskMs:Math.round((idleMetrics.TaskDuration-initial.TaskDuration)*1000)},
    dom:{initialNodes:initial.Nodes,finalNodes:final.Nodes,visibleNoteRows:await page.locator('.note-row').count(),treeNotes:await page.locator('.tree-note').count()},
    heapMB:{initial:Math.round(initial.JSHeapUsedSize/1048576*10)/10,final:Math.round(final.JSHeapUsedSize/1048576*10)/10},
    search:{ipc:diff(searchBefore,searchAfter),settleAfterLastInputMs:searchSettle,inputToFrameP95Ms:Math.round(percentile(searchFrames,.95)*10)/10},
    edit:{ipc:diff(editBefore,editAfter),durationMs:Math.round(performance.now()-editStart),inputToFrameP95Ms:Math.round(percentile(inputFrames,.95)*10)/10},
    longTasks:{count:longTasks.length,maxMs:Math.round(Math.max(0,...longTasks))},errors};
  fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));await app.close();
}catch(e){console.error(e);console.error('Artifacts:',runDir);await app?.close().catch(()=>{});process.exitCode=1;}
