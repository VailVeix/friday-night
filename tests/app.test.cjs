const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(config={}, fetchImpl=async()=>{throw Error('Unexpected network call');}, initialDemo=null) {
  const elements=new Map();
  const get=s=>{if(!elements.has(s))elements.set(s,{
    value:s==='#sort'?'oldest':s==='#add-type'?'movie':'',textContent:'',innerHTML:'',hidden:false,checked:false,disabled:false,dataset:{},listeners:{},
    addEventListener(event,fn){this.listeners[event]=fn;},setAttribute(k,v){this[k]=v;},
    replaceChildren(){this.innerHTML='';},prepend(){},focus(){},showModal(){this.open=true;},close(){this.open=false;},querySelectorAll(){return [];}
  });return elements.get(s);};
  const tabs=['all','movie','series','tv'].map(t=>{const e=get('[data-type='+t+']');e.dataset.type=t;return e;});
  get('#tonight-panel').hidden=true;
  const store=()=>{const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};};
  const localStorage=store(),sessionStorage=store();
  if(initialDemo)localStorage.setItem('friday-demo',JSON.stringify(initialDemo));
  const context=vm.createContext({window:{WATCH_CONFIG:config},document:{querySelector:get,querySelectorAll:s=>s==='[data-type]'?tabs:[],hidden:false,activeElement:null},localStorage,sessionStorage,fetch:fetchImpl,AbortSignal,structuredClone,crypto:globalThis.crypto,setInterval:()=>0,setTimeout:()=>0,clearTimeout:()=>{},Blob,URL,console});
  vm.runInContext(fs.readFileSync(path.join(root,'seed.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(root,'series.js'),'utf8'),context);
  // Unit scenarios use actual responses, not the visual sample data.
  localStorage.setItem('friday-demo',JSON.stringify({...initialDemo || {items:context.window.WATCH_SEED,votes:[],people:[]},sampleVersion:2}));
  if(config.supabaseUrl)localStorage.removeItem('friday-demo');
  vm.runInContext(fs.readFileSync(path.join(root,'app.js'),'utf8'),context);
  const event=()=>({preventDefault(){},submitter:{disabled:false}});
  return {context,get,tabs,localStorage,sessionStorage,event,
    async join(name,code=''){get('#name').value=name;get('#code').value=code;await get('#join-form').listeners.submit(event());},
    async vote(id,interest){const button={dataset:{vote:interest},disabled:false,closest:()=>({dataset:{id}}),hasAttribute:()=>false};await get('#grid').onclick({target:{closest:()=>button}});},
    data(){return JSON.parse(localStorage.getItem('friday-demo'));}
  };
}
test('imports every nonempty CSV title into the correct category',()=>{
  const h=harness(),items=h.context.window.WATCH_SEED;
  assert.equal(items.length,46);assert.equal(new Set(items.map(i=>i.id)).size,46);
  for(const [type,count] of [['movie',19],['series',10],['tv',17]])assert.equal(items.filter(i=>i.type===type).length,count);
  assert.ok(items.some(i=>i.title==='Alien Stage'&&i.original_title==='alien stage (rewatch)'&&i.notes.includes('Rewatch')&&i.type==='tv'));
  assert.ok(items.some(i=>i.original_title==='rpdr s6'&&i.title.includes('Season 6')));assert.ok(items.some(i=>i.title==="The Emperor's New Groove"));
  assert.equal(h.get('#count').textContent,46);
});
test('interest replaces the previous choice and selecting it again clears it',async()=>{
  const h=harness();await h.join('Alex');const id=h.context.window.WATCH_SEED[0].id;
  await h.vote(id,'hold');assert.equal(h.data().votes[0].interest,'hold');
  await h.vote(id,'interested');assert.equal(h.data().votes.length,1);assert.equal(h.data().votes[0].interest,'interested');
  await h.vote(id,'interested');assert.equal(h.data().votes.length,0);
  assert.equal(h.get('#count').textContent,46);
  await h.vote(id,'idc');assert.equal(h.data().votes[0].interest,'idc');
  await h.vote(id,'pass');assert.equal(h.get('#count').textContent,46);
  h.get('#tonight-button').onclick();h.get('#attendees-all').onclick();h.get('#tonight-apply').onclick();
  assert.equal(h.get('#count').textContent,45);
});
test('quick add deduplicates and escapes title HTML',async()=>{
  const h=harness();await h.join('Alex');h.get('#quick-titles').value='big lebowski\nNew film\nNew film\n<img src=x onerror=alert(1)>';
  await h.get('#quick-form').onsubmit(h.event());
  assert.equal(h.data().items.length,48);assert.ok(h.get('#grid').innerHTML.includes('&lt;img src=x onerror=alert(1)&gt;'));assert.ok(!h.get('#grid').innerHTML.includes('<img src=x'));
});
test('live line-by-line add resolves each title and saves matched details',async()=>{
  let added;const lookups=[];
  const h=harness({supabaseUrl:'https://example.supabase.co',supabasePublishableKey:'public'},async(url,options)=>{
    const body=JSON.parse(options.body);
    if(url.endsWith('/metadata')){lookups.push(body);return {ok:true,json:async()=>body.title==='Matched (2025)'?{tmdb_id:42,poster_path:'/poster.jpg',year:'2025'}:null};}
    if(body.p_action==='add')added=body.p_payload.items;
    return {ok:true,json:async()=>body.p_action==='list'?{items:[],votes:[],people:[]}:true};
  });
  await h.join('Alex','test-code');h.get('#quick-titles').value='Matched (2025)\nAmbiguous\nMatched (2025)';
  await h.get('#quick-form').onsubmit(h.event());
  assert.deepEqual(lookups.map(x=>x.title),['Matched (2025)','Ambiguous']);
  assert.ok(lookups.every(x=>x.action==='resolve'&&x.type==='movie'));
  assert.equal(added[0].tmdb_id,42);assert.equal(added[0].poster_path,'/poster.jpg');assert.equal(added[1].title,'Ambiguous');assert.equal(added[1].tmdb_id,undefined);
  assert.match(h.get('#toast').textContent,/1 of 2 titles matched/);
});
test('line-by-line titles are still saved when poster lookup is unavailable',async()=>{
  let added;
  const h=harness({supabaseUrl:'https://example.supabase.co',supabasePublishableKey:'public'},async(url,options)=>{
    if(url.endsWith('/metadata'))return {ok:false,json:async()=>({error:'Lookup unavailable'})};
    const body=JSON.parse(options.body);if(body.p_action==='add')added=body.p_payload.items;
    return {ok:true,json:async()=>body.p_action==='list'?{items:[],votes:[],people:[]}:true};
  });
  await h.join('Alex','test-code');h.get('#quick-titles').value='First\nSecond';
  await h.get('#quick-form').onsubmit(h.event());assert.equal(added.length,2);assert.match(h.get('#toast').textContent,/Lookup is unavailable/);
});
test('search and category filters compose',()=>{
  const h=harness();h.get('#search').value='alien';h.get('#search').listeners.input();assert.equal(h.get('#count').textContent,2);
  h.tabs.find(t=>t.dataset.type==='tv').onclick();assert.equal(h.get('#count').textContent,1);
});
test('tonight excludes absent Absolutely picks and shows only selected people',async()=>{
  const h=harness();const id=h.context.window.WATCH_SEED[0].id;await h.join('Alex');await h.vote(id,'hold');await h.join('Lyss');
  h.get('#tonight-button').onclick();
  h.get('#attendees').querySelectorAll=()=>[{value:'Lyss'}];h.get('#attendees').onchange();h.get('#tonight-apply').onclick();
  assert.ok(!h.get('#grid').innerHTML.includes('data-id="'+id+'"'));
  assert.ok(!h.get('#grid').innerHTML.includes('aria-label="Alex:'));
  assert.ok(h.get('#grid').innerHTML.includes('aria-label="Lyss:'));
  h.get('#attendees-none').onclick();h.get('#tonight-apply').onclick();
  assert.ok(h.get('#grid').innerHTML.includes('data-id="'+id+'"'));
  assert.ok(h.get('#grid').innerHTML.includes('aria-label="Alex:'));
  assert.ok(h.get('#grid').innerHTML.includes('aria-label="Wils:'));
  assert.ok(h.get('#grid').innerHTML.includes('aria-label="Michelle:'));
});
test('new members can vote and attendance applies Nope and Absolutely rules',async()=>{
  const h=harness(),id=h.context.window.WATCH_SEED[0].id;
  await h.join('Wils');await h.vote(id,'hold');await h.join('Michelle');await h.vote(id,'idc');
  const select=people=>{h.get('#attendees').querySelectorAll=()=>people.map(value=>({value}));h.get('#attendees').onchange();h.get('#tonight-apply').onclick();};
  select(['Michelle']);assert.equal(h.get('#count').textContent,45);
  select(['Wils','Michelle']);assert.equal(h.get('#count').textContent,46);
  await h.vote(id,'pass');assert.equal(h.get('#count').textContent,45);
  select(['Wils']);assert.equal(h.get('#count').textContent,46);
  assert.ok(h.get('#grid').innerHTML.includes('aria-label="Wils: Absolutely'));
  assert.ok(!h.get('#grid').innerHTML.includes('aria-label="Michelle:'));
});
test('live requests send group code in POST body and never put it in a URL',async()=>{
  const calls=[];const h=harness({supabaseUrl:'https://example.supabase.co',supabasePublishableKey:'sb_publishable_public'},async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({items:[],votes:[],people:[]})};});
  assert.equal(h.get('#join-dialog').open,true);await h.join('Alex','a-long-secret-group-code');
  assert.equal(calls.length,1);assert.equal(calls[0].url,'https://example.supabase.co/rest/v1/rpc/watch_api');assert.equal(calls[0].options.method,'POST');assert.equal(JSON.parse(calls[0].options.body).p_code,'a-long-secret-group-code');
  assert.equal(h.localStorage.getItem('friday-code'),null);assert.equal(JSON.parse(h.sessionStorage.getItem('friday-code')),'a-long-secret-group-code');
});
test('wrong code keeps the join dialog open without saving credentials',async()=>{
  const h=harness({supabaseUrl:'https://example.supabase.co',supabasePublishableKey:'public'},async()=>({ok:false,json:async()=>({message:'Invalid group code'})}));
  await h.join('Alex','wrong-long-group-code');assert.equal(h.get('#join-dialog').open,true);assert.equal(h.sessionStorage.getItem('friday-code'),null);assert.match(h.get('#join-error').textContent,/didn’t work/);
});
test('failed shared vote is visible and never creates a local-only vote',async()=>{
  let fail=false;const h=harness({supabaseUrl:'https://example.supabase.co',supabasePublishableKey:'public'},async()=>fail?{ok:false,json:async()=>({message:'Database unavailable'})}:{ok:true,json:async()=>({items:h.context.window.WATCH_SEED,votes:[],people:[]})});
  await h.join('Alex','a-long-secret-group-code');fail=true;await h.vote(h.context.window.WATCH_SEED[0].id,'hold');assert.match(h.get('#toast').textContent,/couldn’t be reached/);assert.equal(h.data(),null);
});
test('title upgrades preserve existing local votes, watched status, and additions',()=>{
  const id='00000000-0000-4000-8000-000000000001';
  const h=harness({},undefined,{items:[{id,title:'big lebowski',type:'movie',watched:true},{id:'custom',title:'Our custom addition',type:'tv',watched:false}],votes:[{item_id:id,name:'Alex',interest:'hold'}],people:['Alex']});
  const data=h.data();assert.equal(data.items[0].title,'The Big Lebowski');assert.equal(data.items[0].watched,true);assert.equal(data.votes[0].interest,'hold');assert.equal(data.items[1].title,'Our custom addition');
});
test('abbreviations remain searchable after matching',()=>{
  const h=harness();h.get('#search').value='gbbo';h.get('#search').listeners.input();assert.equal(h.get('#count').textContent,1);assert.ok(h.get('#grid').innerHTML.includes('The Great British Bake Off'));
});
test('catalog links are valid and uncertain versions are not silently assigned',()=>{
  const h=harness(),items=h.context.window.WATCH_SEED;
  assert.equal(items.filter(i=>i.imdb_id).length,36);
  for(const item of items){if(item.imdb_id)assert.match(item.imdb_id,/^tt\d+$/);assert.ok(item.original_title);assert.ok(item.source_url?.startsWith('https://'));}
  for(const title of ['House Arrest','Survivor']){const item=items.find(i=>i.title===title);assert.equal(item.match_status,'needs_confirmation');assert.equal(item.imdb_id,undefined);}
  const charmed=items.find(i=>i.title==='Charmed');assert.equal(charmed.year,'1998');assert.equal(charmed.imdb_id,'tt0158552');
});
