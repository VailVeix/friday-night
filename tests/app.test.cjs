const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(config={}, fetchImpl=async()=>{throw Error('Unexpected network call');}, initialDemo=null, roster=['Alex','Lyss','Julie','Blue','Ashe','Amanda','Emi','Wils','Michelle'], saved={}) {
  const elements=new Map();
  const get=s=>{if(!elements.has(s))elements.set(s,{
    value:s==='#sort'?'oldest':s==='#add-type'?'movie':'',textContent:'',innerHTML:'',hidden:false,checked:false,disabled:false,dataset:{},listeners:{},
    addEventListener(event,fn){this.listeners[event]=fn;},setAttribute(k,v){this[k]=v;},
    replaceChildren(){this.innerHTML='';},prepend(){},focus(){},showModal(){this.open=true;},close(){this.open=false;},querySelectorAll(){return [];}
  });return elements.get(s);};
  const tabs=['all','movie','series','tv'].map(t=>{const e=get('[data-type='+t+']');e.dataset.type=t;return e;});
  const views=['browse','watched','personal'].map(v=>{const e=get('[data-view='+v+']');e.dataset.view=v;return e;});
  get('#tonight-panel').hidden=true;
  const store=()=>{const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};};
  const localStorage=store(),sessionStorage=store();
  for(const [key,value] of Object.entries(saved.local||{}))localStorage.setItem(key,JSON.stringify(value));
  for(const [key,value] of Object.entries(saved.session||{}))sessionStorage.setItem(key,JSON.stringify(value));
  if(initialDemo)localStorage.setItem('friday-demo',JSON.stringify(initialDemo));
  const fetch=(url,options)=>url.endsWith('/rpc/watch_people')?Promise.resolve({ok:true,json:async()=>roster}):fetchImpl(url,options);
  const context=vm.createContext({window:{WATCH_CONFIG:config},document:{querySelector:get,querySelectorAll:s=>s==='[data-type]'?tabs:s==='[data-view]'?views:[],hidden:false,activeElement:null},localStorage,sessionStorage,fetch,AbortSignal,structuredClone,crypto:globalThis.crypto,setInterval:()=>0,setTimeout:()=>0,clearTimeout:()=>{},Blob,URL,console});
  vm.runInContext(fs.readFileSync(path.join(root,'seed.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(root,'series.js'),'utf8'),context);
  // Unit scenarios use actual responses, not the visual sample data.
  localStorage.setItem('friday-demo',JSON.stringify({...initialDemo || {items:context.window.WATCH_SEED,votes:[],people:[]},sampleVersion:2}));
  if(config.supabaseUrl)localStorage.removeItem('friday-demo');
  vm.runInContext(fs.readFileSync(path.join(root,'app.js'),'utf8'),context);
  const event=()=>({preventDefault(){},submitter:{disabled:false}});
  return {context,get,tabs,views,localStorage,sessionStorage,event,
    async join(name,code=''){get('#name').value=name;get('#code').value=code;await get('#join-form').listeners.submit(event());},
    async vote(id,interest){const button={dataset:{vote:interest},disabled:false,closest:()=>({dataset:{id}}),hasAttribute:()=>false};await get('#grid').onclick({target:{closest:()=>button}});},
    async seen(id){const button={dataset:{},disabled:false,closest:()=>({dataset:{id}}),hasAttribute:attribute=>attribute==='data-seen'};await get('#grid').onclick({target:{closest:()=>button}});},
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

test('applying attendees ranks eligible titles by interest and allows a saved sort override',async()=>{
  const demo={items:[
    {id:'less-interest',title:'A film',type:'movie',created_at:'2020-01-01'},
    {id:'more-interest',title:'B film',type:'movie',created_at:'2020-01-02'},
    {id:'absent-pick',title:'C film',type:'movie',created_at:'2020-01-03'}
  ],votes:[{item_id:'less-interest',name:'Alex',interest:'interested'},{item_id:'more-interest',name:'Alex',interest:'hold'},{item_id:'more-interest',name:'Lyss',interest:'interested'},{item_id:'absent-pick',name:'Julie',interest:'hold'}],people:['Alex','Lyss','Julie']};
  const h=harness({},undefined,demo);await h.join('Alex');
  h.get('#attendees').querySelectorAll=()=>[{value:'Alex'},{value:'Lyss'}];h.get('#attendees').onchange();h.get('#tonight-apply').onclick();
  assert.equal(h.get('#sort').value,'interest');assert.equal(JSON.parse(h.localStorage.getItem('friday-sort')),'interest');
  assert.ok(h.get('#grid').innerHTML.indexOf('data-id="more-interest"')<h.get('#grid').innerHTML.indexOf('data-id="less-interest"'));
  assert.ok(!h.get('#grid').innerHTML.includes('data-id="absent-pick"'));
  h.get('#sort').value='title';h.get('#sort').listeners.change();
  assert.ok(h.get('#grid').innerHTML.indexOf('data-id="less-interest"')<h.get('#grid').innerHTML.indexOf('data-id="more-interest"'));
  const reload=harness({},undefined,demo,undefined,{local:{'friday-tonight':['Alex','Lyss'],'friday-sort':'title'}});
  assert.equal(reload.get('#sort').value,'title','A new visit retains the user override');
});

test('vote labels explain attendance and saved picks have a text Edit control',async()=>{
  const h=harness();await h.join('Alex');const id=h.context.window.WATCH_SEED[0].id;
  assert.match(h.get('#grid').innerHTML,/★ Wait for me/);assert.match(h.get('#grid').innerHTML,/Either way/);
  await h.vote(id,'interested');assert.match(h.get('#grid').innerHTML,/Your pick: Yes/);
  assert.match(h.get('#grid').innerHTML,/data-edit-vote[^>]*>Edit<\/button>/);
  await h.vote(id,'hold');assert.match(h.get('#grid').innerHTML,/Your pick: ★ Wait for me/);
  assert.match(h.get('#grid').innerHTML,/off tonight.*list when I.*absent/);
  assert.equal(h.data().votes.find(v=>v.item_id===id).interest,'hold','Renaming preserves the stored response value');
});

test('Filters stays open while changing categories and closes on toggle',()=>{
  const h=harness();assert.equal(h.get('#filters-toggle')['aria-expanded'],'false');
  h.get('#filters-toggle').onclick();h.tabs.find(t=>t.dataset.type==='movie').onclick();
  assert.equal(h.get('#filters-panel').className,'filters-panel is-open');assert.equal(h.get('#filters-toggle').textContent,'Filters · Films');
  h.get('#filters-toggle').onclick();assert.equal(h.get('#filters-panel').className,'filters-panel');
  assert.equal(h.get('#filters-toggle')['aria-expanded'],'false');
});

test('layout and response initials preferences persist across filters and visits',()=>{
  const h=harness();assert.equal(h.get('#grid').className,'grid');
  h.get('#layout-grid').onclick();h.get('#show-initials').checked=false;h.get('#show-initials').listeners.change();
  h.tabs.find(t=>t.dataset.type==='series').onclick();
  assert.equal(h.get('#grid').className,'grid card-grid hide-initials');
  assert.equal(h.get('#layout-grid')['aria-pressed'],'true');
  const reload=harness({},undefined,null,undefined,{local:{'friday-layout':JSON.parse(h.localStorage.getItem('friday-layout')),'friday-show-initials':JSON.parse(h.localStorage.getItem('friday-show-initials'))}});
  assert.equal(reload.get('#grid').className,'grid card-grid hide-initials');
  reload.get('#layout-list').onclick();assert.equal(reload.get('#grid').className,'grid hide-initials');
  reload.get('#show-initials').checked=true;reload.get('#show-initials').listeners.change();assert.equal(reload.get('#grid').className,'grid');
});

const olsenDemo=()=>({items:[
  {id:'twins-1995',title:'It Takes Two',type:'movie',year:'1995',watched:false},
  {id:'paris',title:'Passport to Paris',type:'movie',year:'1999',watched:true},
  {id:'other-version',title:'It Takes Two',type:'movie',year:'1988',watched:false}
],votes:[{item_id:'twins-1995',name:'Alex',interest:'hold'}],seen:[{item_id:'paris',name:'Alex'}],people:['Alex']});
const openCard=(h,id)=>h.get('#grid').onclick({target:{closest:()=>({closest:()=>({dataset:{id}}),hasAttribute:attribute=>attribute==='data-open'})}});
const archiveDetail=h=>h.get('#detail-content').onclick({target:{closest:selector=>selector==='[data-archive]'?{disabled:false}:null}});

test('group watches snapshot applied attendees and show the saved date and people',async()=>{
  const h=harness({},undefined,{items:[{id:'watch-date',title:'Watch date test',type:'movie',watched:false}],votes:[],seen:[{item_id:'watch-date',name:'Lyss',created_at:'2020-01-01T00:00:00Z'}],people:[]});
  await h.join('Alex');h.get('#attendees-main').onclick();h.get('#tonight-apply').onclick();
  h.get('#attendees-all').onclick(); // An un-applied draft must not change recorded attendance.
  await openCard(h,'watch-date');await archiveDetail(h);
  let item=h.data().items[0];
  assert.deepEqual(item.watched_attendees,['Alex','Lyss','Julie','Blue','Ashe','Amanda','Emi']);
  assert.equal(item.watched_by,'Alex');assert.match(item.watched_on,/^\d{4}-\d{2}-\d{2}$/);assert.ok(Date.parse(item.watched_at));
  assert.deepEqual(h.data().seen.map(s=>s.name).sort(),['Alex','Lyss','Julie','Blue','Ashe','Amanda','Emi'].sort(),'Every attendee is personally seen and absent people are excluded');
  assert.equal(h.data().seen.find(s=>s.name==='Lyss').created_at,'2020-01-01T00:00:00Z','Existing personal history is preserved');
  h.get('#attendees-none').onclick();
  h.views.find(v=>v.dataset.view==='watched').onclick();await openCard(h,'watch-date');
  assert.match(h.get('#detail-content').innerHTML,/With Alex, Lyss, Julie, Blue, Ashe, Amanda, Emi/);
  assert.match(h.get('#detail-content').innerHTML,/Marked by Alex/);
  await archiveDetail(h);item=h.data().items[0];assert.equal(item.watched,false);assert.equal(item.watched_at,null);assert.equal(item.watched_attendees,null);
  assert.equal(h.data().seen.length,7,'Restoring the group list keeps personal viewing history');
  h.views.find(v=>v.dataset.view==='browse').onclick();await openCard(h,'watch-date');await archiveDetail(h);
  assert.equal(h.data().items[0].watched_attendees,null,'No attendee selection must not imply everybody watched');
});

test('group checklist dates and attendee snapshots survive duplicate saves',async()=>{
  const h=harness();await h.join('Alex');const series=h.data().items.find(i=>i.title==='Alien');
  h.get('#attendees-main').onclick();h.get('#tonight-apply').onclick();await openCard(h,series.id);
  const toggle=async(person,checked)=>{
    const input={dataset:{film:'0',person},checked,disabled:false};
    await h.get('#detail-content').onchange({target:{matches:()=>false,closest:selector=>selector==='[data-film]'?input:null}});
  };
  await toggle('Group',true);const saved=h.data().progress.find(p=>p.name==='Group');
  assert.equal(saved.watched_attendees.length,7);assert.ok(saved.watched_at);assert.match(h.get('#detail-content').innerHTML,/With Alex, Lyss/);
  assert.equal(h.data().progress.filter(p=>p.name!=='Group').length,7,'Attendees receive personal film progress');
  assert.ok(!h.data().seen?.length,'A single film does not mark the whole series seen');
  h.get('#attendees-none').onclick();await toggle('Group',true);
  assert.deepEqual(h.data().progress.find(p=>p.name==='Group'),saved,'A duplicate check must retain the original date and attendees');
  await toggle('Alex',true);assert.equal(h.data().progress.find(p=>p.name==='Alex').watched_at,undefined,'Personal progress does not record group attendance');
  await toggle('Group',false);assert.ok(!h.data().progress.some(p=>p.name==='Group'));assert.ok(h.data().progress.some(p=>p.name==='Alex'));
});

test('live group watches send the applied snapshot and reject an unmigrated backend',async()=>{
  for(const migrated of [true,false]){
    const writes=[];
    const h=harness({supabaseUrl:'https://example.supabase.co',supabasePublishableKey:'public'},async(url,options)=>{
      const body=JSON.parse(options.body);
      if(body.p_action==='watched')writes.push(body.p_payload);
      return {ok:true,json:async()=>body.p_action==='list'?{watch_details_version:migrated?2:undefined,items:[{id:'shared-watch',title:'Shared watch',type:'movie',tmdb_id:1,watched:false}],votes:[],people:[]}:true};
    });
    await h.join('Alex','test-code');h.get('#attendees-main').onclick();h.get('#tonight-apply').onclick();await openCard(h,'shared-watch');await archiveDetail(h);
    if(migrated){assert.equal(writes[0].attendees.length,7);assert.equal(writes[0].recorded_by,'Alex');assert.equal(typeof writes[0].time_zone,'string');assert.equal(writes[0].watched_at,undefined,'The server supplies the timestamp');}
    else{assert.equal(writes.length,0);assert.match(h.get('#toast').textContent,/watch-history database update/);}
  }
});

test('Mary-Kate and Ashley collection preserves films and avoids other title versions',async()=>{
  const h=harness({},undefined,olsenDemo());await h.join('Alex');
  assert.equal(h.get('#count').textContent,2);assert.match(h.get('#grid').innerHTML,/Mary-Kate &amp; Ashley/);
  assert.ok(!h.get('#grid').innerHTML.includes('data-id="twins-1995"'));
  assert.ok(h.get('#grid').innerHTML.includes('data-id="other-version"'));
  assert.equal(h.data().items.length,3);assert.deepEqual(h.data().votes,olsenDemo().votes);
  await openCard(h,'collection:mary-kate-ashley');
  assert.match(h.get('#detail-content').innerHTML,/data-member-open="twins-1995"/);
  assert.match(h.get('#detail-content').innerHTML,/data-member-open="paris"/);
  h.get('#search').value='Passport';h.get('#search').listeners.input();assert.equal(h.get('#count').textContent,0,'Watched member does not make a search match in the watch list');
  h.views.find(v=>v.dataset.view==='watched').onclick();assert.match(h.get('#grid').innerHTML,/Mary-Kate &amp; Ashley/);
  h.views.find(v=>v.dataset.view==='personal').onclick();assert.match(h.get('#grid').innerHTML,/data-id="paris"/);
  assert.ok(!h.get('#grid').innerHTML.includes('collection:mary-kate-ashley'));
});

test('collection checklist saves progress to the original film and keeps responses intact',async()=>{
  const h=harness({},undefined,olsenDemo());await h.join('Alex');await openCard(h,'collection:mary-kate-ashley');
  const toggle=async(person,checked)=>{
    const input={dataset:{memberId:'twins-1995',person},checked,disabled:false};
    await h.get('#detail-content').onchange({target:{closest:s=>s==='[data-member-id]'?input:null}});
  };
  await toggle('Group',true);assert.equal(h.data().items.find(i=>i.id==='twins-1995').watched,true);
  await toggle('Alex',true);assert.ok(h.data().seen.some(s=>s.item_id==='twins-1995'&&s.name==='Alex'));
  await toggle('Group',false);assert.equal(h.data().items.find(i=>i.id==='twins-1995').watched,false);
  assert.deepEqual(h.data().votes,olsenDemo().votes);assert.equal(h.data().items.length,3);
});

test('tonight eligibility is checked per collection film',async()=>{
  const demo=olsenDemo();demo.items[1].watched=false;
  const h=harness({},undefined,demo);await h.join('Lyss');
  h.get('#attendees').querySelectorAll=()=>[{value:'Lyss'}];h.get('#attendees').onchange();h.get('#tonight-apply').onclick();
  h.get('#search').value='It Takes Two';h.get('#search').listeners.input();
  assert.equal(h.get('#count').textContent,1);assert.ok(!h.get('#grid').innerHTML.includes('collection:mary-kate-ashley'));
  h.get('#search').value='Mary-Kate';h.get('#search').listeners.input();
  assert.equal(h.get('#count').textContent,1);assert.match(h.get('#grid').innerHTML,/Next: Passport to Paris/);
});

test('individual films are searchable and partial series progress appears in Watched',async()=>{
  const h=harness();await h.join('Alex');
  h.get('#search').value='Prometheus';h.get('#search').listeners.input();
  assert.equal(h.get('#count').textContent,1);assert.match(h.get('#grid').innerHTML,/View films/);
  const series=h.data().items.find(i=>i.title==='Alien');
  const saved=h.data();saved.progress=[{item_id:series.id,film:'Alien (1979)',name:'Group'}];
  const reloaded=harness({},undefined,saved);
  reloaded.views.find(v=>v.dataset.view==='watched').onclick();
  assert.match(reloaded.get('#grid').innerHTML,/Next: Aliens/);
  assert.match(reloaded.get('#grid').innerHTML,/1 watched/);
});

test('lookup ignores stale responses and selecting a poster result leaves adding open',async()=>{
  let finishOld;const added=[];
  const h=harness({supabaseUrl:'https://example.supabase.co',supabasePublishableKey:'public'},async(url,options)=>{
    const body=JSON.parse(options.body);
    if(url.endsWith('/metadata')){
      if(body.action==='search'&&body.query==='Old')return new Promise(resolve=>{finishOld=()=>resolve({ok:true,json:async()=>[{tmdb_id:1,title:'Old'}]});});
      return {ok:true,json:async()=>body.action==='search'?[{tmdb_id:2,title:'New',poster_path:'/new.jpg'}]:{tmdb_id:2,poster_path:'/new.jpg'}};
    }
    if(body.p_action==='add')added.push(...body.p_payload.items);
    return {ok:true,json:async()=>body.p_action==='list'?{items:[],votes:[],people:[]}:true};
  });
  await h.join('Alex','test-code');h.get('#add-button').onclick();
  h.get('#lookup').value='Old';const old=h.get('#lookup-form').onsubmit(h.event());
  h.get('#lookup').value='New';await h.get('#lookup-form').onsubmit(h.event());finishOld();await old;
  assert.match(h.get('#results').innerHTML,/w185\/new.jpg/);assert.ok(!h.get('#results').innerHTML.includes('>Old<'));
  await h.get('#results').onclick({target:{closest:()=>({dataset:{result:'0'},disabled:false})}});
  assert.equal(added[0].title,'New');assert.equal(h.get('#add-dialog').open,true);assert.equal(h.get('#lookup').value,'');
});

test('bulk unmatched titles open a queue that advances with a match or skip',async()=>{
  const items=[],matched=[];let id=0;
  const h=harness({supabaseUrl:'https://example.supabase.co',supabasePublishableKey:'public'},async(url,options)=>{
    const body=JSON.parse(options.body);
    if(url.endsWith('/metadata'))return {ok:true,json:async()=>body.action==='resolve'?null:body.action==='search'?[{tmdb_id:42,title:body.query}]:{tmdb_id:42}};
    if(body.p_action==='add')items.push(...body.p_payload.items.map(item=>({...item,id:String(++id)})));
    if(body.p_action==='details'){matched.push(body.p_payload.id);Object.assign(items.find(i=>i.id===body.p_payload.id),body.p_payload.details);}
    return {ok:true,json:async()=>body.p_action==='list'?{items:structuredClone(items),votes:[],people:[]}:true};
  });
  await h.join('Alex','test-code');h.get('#add-button').onclick();h.get('#quick-titles').value='First\nSecond';
  await h.get('#quick-form').onsubmit(h.event());await tick();
  assert.equal(h.get('#lookup').value,'First');assert.equal(h.get('#match-queue').hidden,false);
  await h.get('#results').onclick({target:{closest:()=>({dataset:{result:'0'},disabled:false})}});await tick();
  assert.deepEqual(matched,['1']);assert.equal(h.get('#lookup').value,'Second');
  h.get('#skip-match').onclick();assert.equal(h.get('#quick-form').hidden,false);assert.equal(h.get('#match-queue').hidden,true);
  assert.equal(items.length,2);
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
  assert.ok(h.get('#grid').innerHTML.includes('aria-label="Wils: \u2605 Wait for me'));
  assert.ok(!h.get('#grid').innerHTML.includes('aria-label="Michelle:'));
});
test('live requests send group code in POST body and never put it in a URL',async()=>{
  const calls=[];const h=harness({supabaseUrl:'https://example.supabase.co',supabasePublishableKey:'sb_publishable_public'},async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({items:[],votes:[],people:[]})};});
  assert.equal(h.get('#join-dialog').open,true);await h.join('Alex','a-long-secret-group-code');
  assert.equal(calls.length,1);assert.equal(calls[0].url,'https://example.supabase.co/rest/v1/rpc/watch_api');assert.equal(calls[0].options.method,'POST');assert.equal(JSON.parse(calls[0].options.body).p_code,'a-long-secret-group-code');
  assert.equal(JSON.parse(h.localStorage.getItem('friday-code')),'a-long-secret-group-code');assert.equal(h.sessionStorage.getItem('friday-code'),null);
});
test('wrong code keeps the join dialog open without saving credentials',async()=>{
  const h=harness({supabaseUrl:'https://example.supabase.co',supabasePublishableKey:'public'},async()=>({ok:false,json:async()=>({message:'Invalid group code'})}));
  await h.join('Alex','wrong-long-group-code');assert.equal(h.get('#join-dialog').open,true);assert.equal(h.sessionStorage.getItem('friday-code'),null);assert.equal(h.localStorage.getItem('friday-code'),null);assert.match(h.get('#join-error').textContent,/didn’t work/);
});

test('saved code signs in on a fresh visit and existing tab sessions migrate after verification',async()=>{
  for(const storage of ['local','session']){
    const calls=[];
    const h=harness({supabaseUrl:'https://example.supabase.co',supabasePublishableKey:'public'},async(url,options)=>{calls.push(JSON.parse(options.body));return {ok:true,json:async()=>({items:[],votes:[],people:['Alex']})};},null,undefined,{[storage]:{'friday-code':'saved-group-code'},local:{'friday-name':'Alex',...(storage==='local'?{'friday-code':'saved-group-code'}:{})}});
    await tick();assert.equal(calls[0].p_code,'saved-group-code');assert.notEqual(h.get('#join-dialog').open,true);
    assert.equal(JSON.parse(h.localStorage.getItem('friday-code')),'saved-group-code');assert.equal(h.sessionStorage.getItem('friday-code'),null);
    h.get('#forget-device').onclick();assert.equal(h.localStorage.getItem('friday-code'),null);assert.equal(h.localStorage.getItem('friday-name'),null);assert.equal(h.sessionStorage.getItem('friday-code'),null);
  }
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
test('admin-added people appear in both name menus, responses and attendance',async()=>{
  const people=['Alex','Wils','Michelle','Jo <friend>'];let vote;
  const h=harness({supabaseUrl:'https://example.supabase.co',supabasePublishableKey:'public'},async(url,options)=>{
    const body=JSON.parse(options.body);
    if(body.p_action==='vote')vote=body.p_payload;
    if(url.endsWith('/metadata'))return {ok:true,json:async()=>null};
    return {ok:true,json:async()=>body.p_action==='list'?{items:[{id:'test-title',title:'Movie',type:'movie',tmdb_id:1}],votes:[],people}:true};
  },null,people);
  await tick();
  assert.ok(h.get('#name').innerHTML.includes('Jo &lt;friend&gt;'));assert.ok(h.get('#identity').innerHTML.includes('Jo &lt;friend&gt;'));
  await h.join('Jo <friend>','test-code');
  assert.ok(h.get('#grid').innerHTML.includes('aria-label="Jo &lt;friend&gt;: Not answered'));
  assert.ok(h.get('#attendees').innerHTML.includes('Jo &lt;friend&gt;'));
  await h.vote('test-title','interested');assert.equal(vote.name,'Jo <friend>');
});
test('personal seen is independent per person, reversible, and preserves votes and the group list',async()=>{
  const h=harness(),id=h.context.window.WATCH_SEED[0].id;
  await h.join('Alex');await h.vote(id,'hold');const votes=h.data().votes;
  await h.seen(id);assert.deepEqual(h.data().seen,[{item_id:id,name:'Alex'}]);
  assert.deepEqual(h.data().votes,votes);assert.equal(h.data().items[0].watched,false);assert.equal(h.get('#count').textContent,46);
  await h.join('Michelle');await h.seen(id);assert.equal(h.data().seen.length,2);
  await h.join('Alex');await h.seen(id);assert.deepEqual(h.data().seen,[{item_id:id,name:'Michelle'}]);
  const reload=harness({},undefined,h.data());await reload.join('Michelle');
  assert.ok(reload.get('#grid').innerHTML.includes('data-seen aria-pressed="true"'));
  assert.deepEqual(reload.data().votes,votes);assert.equal(reload.data().items[0].watched,false);
});
test('a failed shared seen save is reported without marking it locally',async()=>{
  const h=harness({supabaseUrl:'https://example.supabase.co',supabasePublishableKey:'public'},async(url,options)=>{
    const body=JSON.parse(options.body);
    if(body.p_action==='seen')return {ok:false,json:async()=>({message:'Unavailable'})};
    return {ok:true,json:async()=>({items:[{id:'seen-test',title:'Test movie',type:'movie',tmdb_id:1}],votes:[],seen:[],people:['Alex']})};
  });
  await h.join('Alex','test-code');await h.seen('seen-test');
  assert.match(h.get('#toast').textContent,/couldn’t be reached/);
  assert.ok(h.get('#grid').innerHTML.includes('data-seen aria-pressed="false"'));assert.equal(h.data(),null);
});

test('personal history follows the chosen name, includes group archives, and ignores tonight filters',async()=>{
  const demo={items:[{id:'seen-film',title:'Seen film',type:'movie',watched:false},{id:'seen-show',title:'Seen show',type:'tv',watched:true},{id:'other-film',title:'Other film',type:'movie',watched:false}],votes:[{item_id:'seen-film',name:'Alex',interest:'pass'}],seen:[{item_id:'seen-film',name:'Alex'},{item_id:'seen-show',name:'Alex'},{item_id:'other-film',name:'Michelle'}],people:['Alex','Michelle']};
  const h=harness({},undefined,demo);
  h.views.find(v=>v.dataset.view==='personal').onclick();assert.equal(h.get('#grid').innerHTML,'');assert.match(h.get('#empty').textContent,/Choose your name/);
  await h.join('Alex');
  h.get('#attendees-all').onclick();h.get('#tonight-apply').onclick();
  assert.ok(h.get('#grid').innerHTML.includes('Seen film'));assert.ok(h.get('#grid').innerHTML.includes('Seen show'));assert.ok(!h.get('#grid').innerHTML.includes('Other film'));
  assert.equal(h.get('#tonight-status').hidden,true);assert.equal(h.get('#count').hidden,true);
  h.tabs.find(t=>t.dataset.type==='tv').onclick();assert.ok(!h.get('#grid').innerHTML.includes('Seen film'));assert.ok(h.get('#grid').innerHTML.includes('Seen show'));
  h.tabs.find(t=>t.dataset.type==='all').onclick();h.get('#search').value='film';h.get('#search').listeners.input();assert.ok(!h.get('#grid').innerHTML.includes('Seen show'));
  h.get('#search').value='';h.get('#search').listeners.input();
  await h.join('Michelle');assert.ok(h.get('#grid').innerHTML.includes('Other film'));assert.ok(!h.get('#grid').innerHTML.includes('Seen film'));
  await h.seen('other-film');assert.equal(h.get('#grid').innerHTML,'');assert.match(h.get('#empty').textContent,/Mark titles as seen/);
  assert.deepEqual(h.data().votes,demo.votes);assert.equal(h.data().items.find(i=>i.id==='seen-show').watched,true);
  await h.join('Alex');h.views.find(v=>v.dataset.view==='watched').onclick();assert.ok(h.get('#grid').innerHTML.includes('Seen show'));assert.ok(!h.get('#grid').innerHTML.includes('Seen film'));
});
