// Optional real-browser smoke check: node tests/browser-check.cjs <chrome.exe path>
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const qa=path.join(root,'.qa');fs.mkdirSync(qa,{recursive:true});
let adminPassword='admin-test-password',people=['Alex','Lyss','Julie','Blue','Ashe','Amanda','Emi','Wils','Michelle'];
const seedContext={window:{}};require('node:vm').runInNewContext(fs.readFileSync(path.join(root,'seed.js'),'utf8'),seedContext);
const server=http.createServer(async(req,res)=>{
 const requested=decodeURIComponent(req.url.split('?')[0]);
 const json=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
 if(requested==='/config.js'){res.setHeader('Content-Type','text/javascript');res.end('window.WATCH_CONFIG='+JSON.stringify({supabaseUrl:'http://'+req.headers.host,supabasePublishableKey:'sb_publishable_test'}));return;}
 if(requested.startsWith('/rest/')||requested.startsWith('/functions/')){
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw||'{}');
  if(requested.endsWith('/watch_people'))return json(200,people);
  if(requested.endsWith('/metadata'))return json(200,null);
  if(requested.endsWith('/watch_api'))return body.p_code==='test-code'?json(200,{items:seedContext.window.WATCH_SEED,votes:[],people,progress:[]}):json(400,{message:'Invalid group code'});
  if(requested.endsWith('/watch_admin')){
   if(body.p_password!==adminPassword)return json(400,{message:'Invalid admin password'});
   if(body.p_action==='list')return json(200,people);
   if(body.p_action==='add_person'){
    const name=body.p_payload.name.trim().replace(/\s+/g,' ');
    if(people.some(p=>p.toLowerCase()===name.toLowerCase()))return json(400,{message:'That name is already on the list'});
    people.push(name);return json(200,people);
   }
   if(body.p_action==='change_password'){adminPassword=body.p_payload.password;return json(200,true);}
  }
  return json(404,{});
 }
 const file=path.resolve(root,'.'+(requested.endsWith('/')?requested+'index.html':requested));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 fs.readFile(file,(err,body)=>{if(err){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(body);});
});
let chrome,ws;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  chrome=spawn(process.argv[2]||'chrome',['--headless','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+path.join(qa,'chrome-admin-profile'),'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  const endpoint=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(Error('Chrome did not start: '+log)),20000);chrome.on('error',reject);chrome.stderr.on('data',chunk=>{log+=chunk;const match=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});});
  const port=new URL(endpoint).port;
  const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  let id=0;const pending=new Map();const errors=[];
  ws.onmessage=event=>{const message=JSON.parse(event.data);if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);if(message.id){const p=pending.get(message.id);pending.delete(message.id);message.error?p.reject(Error(JSON.stringify(message.error))):p.resolve(message.result);}};
  const call=(method,params={})=>new Promise((resolve,reject)=>{const next=++id;pending.set(next,{resolve,reject});ws.send(JSON.stringify({id:next,method,params}));});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const waitFor=async expression=>{for(let i=0;i<80;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out waiting for '+expression);};
  await call('Runtime.enable');await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  const base='http://127.0.0.1:'+server.address().port;
  await call('Page.navigate',{url:base+'/admin/'});await waitFor('!!document.querySelector("#admin-login")');
  const login=async password=>{await evaluate('document.querySelector("#admin-password").value='+JSON.stringify(password)+';document.querySelector("#admin-login").requestSubmit()');};
  await login('test-code');await waitFor('document.querySelector("#login-error").textContent.length>0');
  assert.equal(await evaluate('document.querySelector("#manage-panel").hidden'),true);
  await login('admin-test-password');await waitFor('!document.querySelector("#manage-panel").hidden');
  assert.equal(await evaluate('document.querySelector("#admin-password").value'),'');
  await evaluate('document.querySelector("#person-name").value="<b>Guest</b>";document.querySelector("#add-person").requestSubmit()');
  await waitFor('document.querySelectorAll("#people-list li").length===10');
  assert.equal(await evaluate('document.querySelectorAll("#people-list b").length'),0,'Names render as text');
  await evaluate('document.querySelector("#person-name").value="alex";document.querySelector("#add-person").requestSubmit()');
  await waitFor('document.querySelector("#people-error").textContent.includes("already")');
  assert.equal(await evaluate('JSON.stringify({...localStorage,...sessionStorage}).includes("admin-test-password")'),false,'Admin password is not persisted');
  await evaluate('document.querySelector(".password-settings").open=true;document.querySelector("#new-password").value="replacement-admin-password";document.querySelector("#confirm-password").value="replacement-admin-password";document.querySelector("#change-password").requestSubmit()');
  await waitFor('document.querySelector("#password-status").textContent.includes("updated")');
  await evaluate('document.querySelector("#admin-logout").click()');await login('admin-test-password');await waitFor('document.querySelector("#login-error").textContent.length>0');
  await login('replacement-admin-password');await waitFor('!document.querySelector("#manage-panel").hidden');
  await evaluate('document.querySelector(".password-settings").open=false');
  let shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(qa,'admin-desktop.png'),Buffer.from(shot.data,'base64'));
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
  shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(qa,'admin-mobile.png'),Buffer.from(shot.data,'base64'));
  await call('Page.navigate',{url:base+'/'});
  await waitFor('Array.from(document.querySelector("#identity").options).some(o=>o.value==="<b>Guest</b>")');
  assert.equal(await evaluate('Array.from(document.querySelector("#name").options).some(o=>o.value==="<b>Guest</b>")'),true,'New person available before group sign-in');
  await evaluate('document.querySelector("#name").value="<b>Guest</b>";document.querySelector("#code").value="test-code";document.querySelector("#join-form").requestSubmit()');
  await waitFor('document.querySelectorAll(".card").length===46&&!document.querySelector("#join-dialog").open');
  assert.equal(await evaluate('Array.from(document.querySelectorAll(".people-responses")).every(r=>r.children.length===10)'),true);
  assert.equal(await evaluate('document.querySelector("#identity").value'),'<b>Guest</b>');
  await evaluate('document.querySelector("#tonight-button").click();Array.from(document.querySelectorAll("#attendees input")).find(i=>i.value==="<b>Guest</b>").click();document.querySelector("#tonight-apply").click()');
  assert.equal(await evaluate('Array.from(document.querySelectorAll(".people-responses")).every(r=>r.children.length===1&&r.firstElementChild.getAttribute("aria-label").startsWith("<b>Guest</b>:"))'),true);
  await evaluate('location.reload()');await waitFor('document.querySelectorAll(".card").length===46');
  assert.equal(await evaluate('document.querySelector("#identity").value'),'<b>Guest</b>','New person stays selected after reload');
  assert.deepEqual(errors,[]);console.log('PASS: admin login, wrong password, add person, duplicate names, escaped names, password change/sign-out, mobile layout, shared roster across all controls, name survives refresh.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{ws?.close();chrome?.kill();server.close();});