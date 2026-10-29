import { _electron as electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import assert from 'node:assert/strict'; import http from 'node:http';

const root=process.cwd(), require=createRequire(import.meta.url), electronBin=require('electron');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'caderno-clipper-integration-')), userData=path.join(temp,'app-profile'), browserProfile=path.join(temp,'chromium-profile');
fs.mkdirSync(userData); let app,context,server,conflictServer; let assertionCount=0;
const check=(condition,message)=>{assertionCount++;assert.ok(condition,message);};
try {
  conflictServer=http.createServer((_req,res)=>res.end('QA port conflict fixture'));
  await new Promise((resolve,reject)=>{conflictServer.once('error',reject);conflictServer.listen(43187,'127.0.0.1',resolve);});
  const portOwner={pid:process.pid,executable:process.execPath,profile:userData,port:43187};
  server=http.createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(`<!doctype html><title>Fixture Clipper</title><main><article><h1>Artigo limpo</h1><p>Conteudo benigno para captura local.</p><a href="javascript:alert(1)" onclick="document.body.dataset.injected='yes'">link hostil</a><img src="http://127.0.0.1:1/tracker"><script>document.body.dataset.scriptRan='yes'</script><form action="https://example.invalid"><input name="q"></form><iframe src="https://example.invalid"></iframe><noscript><p>hidden host</p></noscript><textarea></textarea/> &lt;img src=x onerror=alert(2)&gt;<meta http-equiv="refresh" content="0;url=javascript:alert(3)"></article></main>`);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); const fixtureUrl=`http://127.0.0.1:${server.address().port}/fixture`;
  const env={...process.env,CADERNO_USER_DATA:userData,CADERNO_DEBUG:'1'};delete env.ELECTRON_RUN_AS_NODE;
  app=await electron.launch({executablePath:electronBin,args:[root],env,timeout:30000});const appPage=await app.firstWindow();await appPage.waitForSelector('.brand',{timeout:20000});
  await appPage.getByTitle('Mais ações').click();await appPage.getByRole('menuitem',{name:'Web Clipper'}).click();
  const dlg=appPage.getByRole('dialog',{name:'Web Clipper'});await dlg.getByRole('button',{name:'Configurar Clipper'}).click();
  await dlg.getByRole('alert').filter({hasText:/EADDRINUSE|address already in use|endereço já está em uso/i}).waitFor({timeout:5000});
  check((await dlg.getByRole('status').innerText()).includes('Conexão desativada.'),'conflito da porta 43187 mantém a ponte desativada e exibe erro acionável');
  await new Promise((resolve,reject)=>conflictServer.close(error=>error?reject(error):resolve()));
  await dlg.getByRole('button',{name:'Configurar Clipper'}).click();
  await dlg.getByRole('status').filter({hasText:'Conexão local ativa em 127.0.0.1:43187.'}).waitFor({timeout:5000});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(900,560));await appPage.setViewportSize({width:900,height:560});
  const evidence=path.join(root,'evidence','functional');fs.mkdirSync(evidence,{recursive:true});
  await appPage.screenshot({path:path.join(evidence,'clipper-settings-light-900x560.png')});
  await dlg.getByRole('button',{name:'Fechar'}).click();
  await appPage.getByTitle('Alternar tema').click();
  await appPage.locator('html[data-theme="dark"]').waitFor({timeout:3000});
  await appPage.getByTitle('Mais ações').click();await appPage.getByRole('menuitem',{name:'Web Clipper'}).click();
  await appPage.getByRole('dialog',{name:'Web Clipper'}).waitFor();
  await appPage.screenshot({path:path.join(evidence,'clipper-settings-dark-900x560.png')});
  await dlg.getByRole('button',{name:'Gerar código de pareamento'}).waitFor();await dlg.getByRole('button',{name:'Gerar código de pareamento'}).click();
  const pairCode=await dlg.locator('strong').innerText(),pairNonce=await dlg.locator('code').innerText();
  check(/^\d{6}$/.test(pairCode)&&/^[a-f0-9]{48}$/.test(pairNonce),'app mostra código curto e nonce temporário');

  const extension=path.join(temp,'extension'),executablePath=path.join(process.env.LOCALAPPDATA,'ms-playwright','chromium-1234','chrome-win64','chrome.exe');
  fs.cpSync(path.join(root,'extensions','clipper'),extension,{recursive:true});
  // Test-only host grant exercises the actual popup capture without pretending
  // that automation granted activeTab through the native toolbar.
  const manifestPath=path.join(extension,'manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  manifest.host_permissions.push('http://127.0.0.1/*');fs.writeFileSync(manifestPath,JSON.stringify(manifest));
  context=await chromium.launchPersistentContext(browserProfile,{executablePath,headless:false,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  const page=context.pages()[0]??await context.newPage();await page.goto('chrome://extensions/');
  const extensionId=await page.waitForFunction(()=>{const manager=document.querySelector('extensions-manager'),list=manager?.shadowRoot?.querySelector('extensions-item-list');const item=list?.shadowRoot?.querySelector('extensions-item');return item?.id||false;}).then(h=>h.jsonValue());
  check(/^[a-p]{32}$/.test(extensionId),'Chromium carregou a extensão unpacked');
  await page.goto(fixtureUrl);await page.waitForSelector('article');
  await page.keyboard.press('Alt+Shift+X');
  let popup;
  for(let i=0;i<40&&!popup;i++){popup=context.pages().find(p=>p.url()===`chrome-extension://${extensionId}/popup.html`);if(!popup)await new Promise(r=>setTimeout(r,100));}
  if(!popup){popup=await context.newPage();await popup.goto(`chrome-extension://${extensionId}/popup.html`);}
  await popup.locator('#code').fill(pairCode);await popup.locator('#nonce').fill(pairNonce);await popup.locator('#pairButton').click();
  await popup.waitForTimeout(1000);
  const extensionToken=await popup.evaluate(()=>chrome.storage.local.get('token').then(x=>x.token));
  check(/^[a-f0-9]{64}$/.test(extensionToken),`token foi armazenado no storage.local da extensão: ${await popup.locator('#message').innerText()}`);
  const paired=await appPage.evaluate(async()=>{const r=await window.cadernoDesktop.invoke('clipper:status',null);return r.ok?r.data:null;});
  check(paired?.paired===true&&paired.enabled===true,'UI do app mostra extensão pareada e ponte ativa');
  const browserDestinations=await popup.evaluate(async()=>{const t=(await chrome.storage.local.get('token')).token;const r=await fetch('http://127.0.0.1:43187/v1/destinations',{method:'POST',headers:{Authorization:`Bearer ${t}`,'Content-Type':'application/json'},body:'{}'});return {status:r.status,body:await r.text()};});
  check(browserDestinations.status===200,`destinos pelo fetch real da extensão: ${JSON.stringify(browserDestinations)}`);
  check(await popup.locator('#pair').isHidden(),'formulário de pareamento fica oculto após conectar');
  check(await popup.locator('#save').isDisabled(),'aba da própria extensão não oferece captura sem uma página válida');
  await page.bringToFront();
  await popup.evaluate(()=>init());
  check(await popup.locator('#save').isEnabled(),`captura habilitada após carregar destinos: ${await popup.locator('#message').innerText()}`);
  await popup.evaluate(()=>document.getElementById('save').click());
  await popup.waitForFunction(()=>document.getElementById('message').textContent.startsWith('Salvo:'));
  const actualNotes=await appPage.evaluate(async()=>{const r=await window.cadernoDesktop.invoke('notes:list',{view:'all'});return r.ok?r.data:[];});
  check(actualNotes.some(n=>n.title==='Fixture Clipper'),'handler real do popup executa extração e salva no SQLite');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].focus());
  await appPage.locator('.notelist').getByText('Fixture Clipper',{exact:true}).waitFor();
  check(true,'nota capturada aparece na lista ao retornar ao Caderno');
  await popup.evaluate(()=>document.getElementById('save').click());
  await popup.waitForFunction(()=>document.getElementById('message').textContent==='Esta página já está salva.');
  check(true,'captura repetida pelo popup mostra duplicação');

  // Separate HTTP client exercises the live app route; this is bridge integration evidence,
  // not evidence that the popup's activeTab capture gesture succeeded.
  const origin=`chrome-extension://${extensionId}`;
  const replayPair=await fetch('http://127.0.0.1:43187/v1/pair',{method:'POST',headers:{Origin:origin,'Sec-Fetch-Site':'none','Content-Type':'application/json'},body:JSON.stringify({code:pairCode,nonce:pairNonce})});
  check(replayPair.status===401,'nonce de pareamento usado não pode ser repetido');
  const unauth=await fetch('http://127.0.0.1:43187/v1/destinations',{headers:{Origin:origin}});
  check(unauth.status===401,'rotas autorizadas recusam requisição sem Bearer');
  const destinations=await fetch('http://127.0.0.1:43187/v1/destinations',{headers:{Origin:origin,Authorization:`Bearer ${extensionToken}`} });
  check(destinations.ok,'cliente HTTP separado lê destinos com token pareado');
  const forbidden=await fetch('http://127.0.0.1:43187/v1/destinations',{headers:{Origin:'https://attacker.invalid',Authorization:`Bearer ${extensionToken}`} });
  check(forbidden.status===403,'Origin externo é recusado mesmo com token');
  const badHost=await new Promise((resolve,reject)=>{const request=http.request({hostname:'127.0.0.1',port:43187,path:'/v1/destinations',method:'GET',headers:{Host:'attacker.invalid',Origin:origin,Authorization:`Bearer ${extensionToken}`} },response=>{response.resume();response.on('end',()=>resolve(response.statusCode));});request.once('error',reject);request.end();});
  check(badHost===403,'Host diferente do loopback é recusado');
  const oversized=await fetch('http://127.0.0.1:43187/v1/clip',{method:'POST',headers:{Origin:origin,Authorization:`Bearer ${extensionToken}`,'Content-Type':'application/json'},body:JSON.stringify({oversized:'x'.repeat(1_000_100)})});
  check(oversized.status===413,'payload acima do limite é recusado');
  const captured=await fetch('http://127.0.0.1:43187/v1/clip',{method:'POST',headers:{Origin:origin,Authorization:`Bearer ${extensionToken}`,'Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),title:'Fixture Clipper',sourceURL:fixtureUrl,sourceDate:'2026-10-28',mode:'article',notebookId:null,text:'Conteudo benigno para captura local.',html:'<article><h1>Artigo limpo</h1><p>Conteudo benigno para captura local.</p><a href="javascript:alert(1)" onclick="alert(1)">link</a><img src="http://127.0.0.1:1/tracker"><script>globalThis.evil=1</script><form><input></form><iframe></iframe><noscript><p>hidden host</p></noscript><textarea></textarea/> &lt;img src=x onerror=alert(2)&gt;<meta http-equiv="refresh" content="0;url=javascript:alert(3)"></article>'})});
  check(captured.status===200&&(await captured.json()).duplicate,'rota local reconhece nota criada pelo popup');

  const notes=await appPage.evaluate(async()=>{const r=await window.cadernoDesktop.invoke('notes:list',{view:'all'});return r.ok?r.data:[];});
  const saved=notes.find(n=>n.title==='Fixture Clipper');check(!!saved,'captura persistiu como nota no SQLite do perfil isolado');
  const full=await appPage.evaluate(async id=>{const r=await window.cadernoDesktop.invoke('notes:get',{id});return r.ok?r.data:null;},saved.id);
  check(full.contentHtml.includes(fixtureUrl)&&full.contentHtml.includes('Artigo limpo'),'nota guarda link de origem e conteúdo');
  const htmlSafety=await appPage.evaluate(html=>{const doc=new DOMParser().parseFromString(html,'text/html'),activeTags=doc.querySelectorAll('script,form,input,iframe,img,noscript,textarea,meta,svg,math').length,eventAttrs=[...doc.querySelectorAll('*')].flatMap(el=>[...el.attributes]).filter(a=>/^on/i.test(a.name)).length,unsafeUrls=[...doc.querySelectorAll('[href],[src],[srcset]')].flatMap(el=>[...el.attributes]).filter(a=>['href','src','srcset'].includes(a.name)&&/javascript:/i.test(a.value)).length;return{activeTags,eventAttrs,unsafeUrls};},full.contentHtml);check(!htmlSafety.activeTags&&!htmlSafety.eventAttrs&&!htmlSafety.unsafeUrls,`HTML salvo contém vetor ativo: ${JSON.stringify(htmlSafety)}`);
  const repeated=await fetch('http://127.0.0.1:43187/v1/clip',{method:'POST',headers:{Origin:origin,Authorization:`Bearer ${extensionToken}`,'Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),title:'Fixture Clipper',sourceURL:fixtureUrl,sourceDate:'2026-10-28',mode:'article',notebookId:null,text:'replay',html:'<p>replay</p>'})});
  check(repeated.status===200&&(await repeated.json()).duplicate,'bridge deduplica URL repetida');
  await dlg.getByRole('button',{name:'Desconectar e revogar acesso'}).click();
  await dlg.getByRole('status').filter({hasText:'Conexão desativada'}).waitFor();
  const afterRevoke=await fetch('http://127.0.0.1:43187/v1/destinations',{headers:{Origin:origin,Authorization:`Bearer ${extensionToken}`}}).catch(()=>null);
  check(afterRevoke===null||!afterRevoke.ok,'revogação encerra a ponte e invalida o token antigo');
  console.log(JSON.stringify({passed:true,assertions:assertionCount,fixtureUrl,extensionId,profile:'TEMP isolado',portConflict:portOwner,screenshots:['clipper-settings-light-900x560.png','clipper-settings-dark-900x560.png'],popupCapture:'DOM handler > chrome.scripting > browser fetch > bridge > SQLite > note list; host grant restricted to fixture in test copy only',limitation:'O gesto nativo activeTab não é simulado nem declarado aprovado; o manifest distribuído continua somente com host da ponte.'}));
} catch(error) { console.error(JSON.stringify({passed:false,assertions:assertionCount,error:String(error),stack:error?.stack}));process.exitCode=1; }
finally {if(context)await context.close().catch(()=>{});if(app)await app.close().catch(()=>{});if(server?.listening)await new Promise(resolve=>server.close(()=>resolve()));if(conflictServer?.listening)await new Promise(resolve=>conflictServer.close(()=>resolve()));if(server?.listening||conflictServer?.listening)throw new Error('Fixture HTTP Clipper não fechou após await server.close()');fs.rmSync(temp,{recursive:true,force:true});}
