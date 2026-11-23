// Optional real-browser smoke check: node tests/browser-check.cjs <chrome.exe path>
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const qa=path.join(root,'.qa');fs.mkdirSync(qa,{recursive:true});
const people=['Alex','Michelle'];
const data={watch_details_version:2,items:[{id:'tv-test',title:'A test show',type:'tv',tmdb_id:42,year:'2020',created_at:'2020-01-01',watched:false}],people,votes:[{item_id:'tv-test',name:'Alex',interest:'hold'}],progress:[],seen:[]};
let failSave=false,failSeason=false,slowSeason=false;
const server=http.createServer(async(req,res)=>{
  const requested=decodeURIComponent(req.url.split('?')[0]);
  const json=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
  if(requested==='/config.js'){res.setHeader('Content-Type','text/javascript');res.end('window.WATCH_CONFIG='+JSON.stringify({supabaseUrl:'http://'+req.headers.host,supabasePublishableKey:'sb_publishable_test'}));return;}
  if(requested.startsWith('/rest/')||requested.startsWith('/functions/')){
    let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw||'{}');
    if(requested.endsWith('/watch_people'))return json(200,people);
    if(requested.endsWith('/metadata')){
      if(body.action==='seasons')return json(200,[{number:1,name:'Season 1',episode_count:2},{number:2,name:'Season 2',episode_count:1},{number:3,name:'Season 3',episode_count:0},{number:0,name:'Specials',episode_count:1}]);
      if(body.action==='episodes'){
        if(body.season===2&&failSeason)return json(502,{error:'Episode lookup unavailable.'});
        if(body.season===2&&slowSeason)await new Promise(r=>setTimeout(r,500));
        return json(200,body.season===3?[]:body.season===1?[{number:1,name:'Pilot <script>',air_date:'2020-01-01'},{number:2,name:'Second episode',air_date:'2020-01-08'}]:[{number:1,name:body.season===0?'A special':'A new season',air_date:'2021-01-01'}]);
      }
      return json(200,null);
    }
    if(body.p_code!=='test-code')return json(400,{message:'Invalid group code'});
    if(body.p_action==='list')return json(200,data);
    if(body.p_action==='progress'){
      if(failSave)return json(503,{message:'Temporarily unavailable'});
      const p=body.p_payload;
      data.progress=data.progress.filter(x=>!(x.item_id===p.id&&x.film===p.film&&x.name===p.name));
      if(p.watched)data.progress.push({item_id:p.id,film:p.film,name:p.name});
      return json(200,true);
    }
    if(body.p_action==='watched'){data.items[0].watched=body.p_payload.watched;return json(200,true);}
    return json(404,{});
  }
  const file=path.resolve(root,'.'+(requested==='/'?'/index.html':requested));
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(err,body)=>{if(err){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(body);});
});
let chrome,ws;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  chrome=spawn(process.argv[2]||'chrome',['--headless','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+path.join(qa,'chrome-tv-profile'),'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
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
  await call('Page.navigate',{url:base});await waitFor('!!document.querySelector("#identity")');
  await evaluate('localStorage.clear();sessionStorage.setItem("friday-code",JSON.stringify("test-code"));localStorage.setItem("friday-name",JSON.stringify("Alex"));location.reload()');
  await waitFor('document.querySelectorAll(".card").length===1');
  const open=async()=>{await evaluate('document.querySelector(".card [data-open]").click()');await waitFor('document.querySelectorAll("[data-episode]").length>0');};
  const select=async number=>{await evaluate('document.querySelector("[data-season]").value='+JSON.stringify(String(number))+';document.querySelector("[data-season]").dispatchEvent(new Event("change",{bubbles:true}))');};
  const toggle=async(number,person)=>{await evaluate('document.querySelector('+JSON.stringify('[data-episode="'+number+'"][data-person="'+person+'"]')+').click()');await waitFor('!!document.querySelector("[data-episode]")&&!document.querySelector("[data-episode]").disabled');};
  await open();
  assert.equal(await evaluate('document.querySelectorAll("[data-episode]").length'),4);
  assert.equal(await evaluate('document.querySelectorAll(".tv-tracker script").length'),0,'Episode names escape HTML');
  await toggle(1,'Group');await toggle(1,'Alex');
  assert.equal(data.progress.length,2);assert.ok(data.progress.every(p=>p.film==='tv:42:1:1'));
  assert.ok(await evaluate('document.querySelector(".tv-tracker").textContent.includes("Next for the group: episode 2")'));
  await toggle(2,'Group');
  assert.ok(await evaluate('document.querySelector(".tv-tracker").textContent.includes("Season complete for the group")'));
  const votes=structuredClone(data.votes);assert.equal(data.items[0].watched,false);assert.equal(data.seen.length,0);
  failSave=true;await toggle(2,'Alex');failSave=false;
  assert.equal(await evaluate('document.querySelector("[data-episode=\\\"2\\\"][data-person=Alex]").checked'),false,'Failed save rolls back');
  assert.ok(await evaluate('document.querySelector("#toast").textContent.includes("couldn’t be reached")'));
  failSeason=true;await select(2);await waitFor('!!document.querySelector("[data-tv-retry]")');
  failSeason=false;slowSeason=true;await evaluate('document.querySelector("[data-tv-retry]").click()');await select(0);
  await waitFor('document.querySelector(".episode-row")?.textContent.includes("A special")');
  await new Promise(r=>setTimeout(r,650));
  assert.equal(await evaluate('document.querySelector("[data-season]").value'),'0','Slow prior season cannot overwrite selection');
  await toggle(1,'Alex');assert.ok(data.progress.some(p=>p.film==='tv:42:0:1'));
  await select(3);await waitFor('document.querySelector(".tv-tracker").textContent.includes("No episodes listed yet")');
  await select(1);await waitFor('document.querySelectorAll("[data-episode]").length===4');
  assert.equal(await evaluate('document.querySelector("[data-episode=\\\"1\\\"][data-person=Alex]").checked'),true);
  await evaluate('document.querySelector("#detail-dialog").close();document.querySelector("#identity").value="Michelle";document.querySelector("#identity").dispatchEvent(new Event("change"))');
  await open();
  assert.equal(await evaluate('document.querySelector("[data-episode=\\\"1\\\"][data-person=Michelle]").checked'),false);
  await toggle(1,'Michelle');await toggle(1,'Michelle');
  assert.ok(!data.progress.some(p=>p.name==='Michelle'));assert.ok(data.progress.some(p=>p.name==='Alex'));
  await evaluate('location.reload()');await waitFor('document.querySelectorAll(".card").length===1');await open();
  assert.equal(await evaluate('document.querySelector("[data-season]").value'),'2','Resume first incomplete group season after reload');
  await select(1);await waitFor('document.querySelectorAll("[data-episode]").length===4');
  assert.equal(await evaluate('document.querySelector("[data-episode=\\\"2\\\"][data-person=Group]").checked'),true,'Saved progress survives reload');
  await evaluate('document.querySelector("[data-archive]").click()');await waitFor('!document.querySelector("#detail-dialog").open');
  await evaluate('document.querySelector("[data-view=watched]").click()');await open();
  assert.equal(await evaluate('document.querySelector("[data-episode=\\\"2\\\"][data-person=Group]").checked'),true,'Archive preserves episode progress');
  await evaluate('document.querySelector("[data-archive]").click()');await waitFor('!document.querySelector("#detail-dialog").open');
  await evaluate('document.querySelector("[data-view=browse]").click()');await open();
  assert.deepEqual(data.votes,votes);
  let shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(qa,'tv-desktop.png'),Buffer.from(shot.data,'base64'));
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth&&document.querySelector("#detail-dialog").scrollWidth<=document.querySelector("#detail-dialog").clientWidth'),true,'Mobile has no horizontal overflow');
  shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(qa,'tv-mobile.png'),Buffer.from(shot.data,'base64'));
  assert.deepEqual(errors,[]);console.log('PASS: TV seasons/episodes, separate group/personal progress, undo, failed saves, lookup retry, out-of-order requests, specials, empty seasons, reload, archive, unchanged votes, mobile layout.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{ws?.close();chrome?.kill();server.close();});