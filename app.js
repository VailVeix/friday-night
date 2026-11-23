/* No build step or browser dependencies. Shared writes always go through the code-gated RPC. */
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const config = window.WATCH_CONFIG || {};
  const live = !!(config.supabaseUrl && config.supabasePublishableKey);
  const types = {movie:'FILM',series:'FILM SERIES',tv:'TV SHOW'};
  const voteLabels = {hold:'★ Wait for me',interested:'Yes',idc:'Either way',pass:'Nope !'};
  const voteHints = {hold:'Keep this off tonight’s list when I’m absent.',interested:'I want to watch, but the group can watch without me.',idc:'I’m happy to watch; either choice works for me.',pass:'Hide this title when I’m joining tonight.'};
  const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const read = (storage, key, fallback) => {try {return JSON.parse(storage.getItem(key)) ?? fallback;} catch {return fallback;}};
  const savedSort=read(localStorage,'friday-sort','oldest');
  $('#sort').value=['oldest','newest','title','interest','unanswered'].includes(savedSort)?savedSort:'oldest';
  let layout=read(localStorage,'friday-layout','list')==='grid'?'grid':'list';
  let showInitials=read(localStorage,'friday-show-initials',true)!==false;
  let name = read(localStorage, 'friday-name', '');
  let names = ["Alex","Lyss","Julie","Blue","Ashe","Amanda","Emi","Wils","Michelle"];
  if(!live&&!names.includes(name))name='';
  let code = read(localStorage, 'friday-code', '') || read(sessionStorage, 'friday-code', '');
  const savedTonight=read(localStorage,'friday-tonight',[]);
  const savedAttendees=Array.isArray(savedTonight)?[...new Set(savedTonight.filter(person=>typeof person==='string'&&person.trim()&&person.length<=40))]:[];
  let data = {items:[],votes:[],people:[]}, type = 'all', tonight = savedAttendees.length?savedAttendees:null, editing = null, results = [], syncing = false;
  let draftTonight=[...savedAttendees];
  let editingVote=null;
  let view='browse', detailId=null, autoRunning=false, quickAdding=false, filtersOpen=false;
  const attempted=new Set();
  const tvShows=new Map();
  const filmMetadata=new Map(),filmLookups=new Map();
  let toastTimer;
  let lookupTimer, lookupRequest=0, matchQueue=[], filmFilter='all', lookupSaving=false;
  let collections=[];
  const toast = message => {$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,4500);};
  function persistDemo() {localStorage.setItem('friday-demo',JSON.stringify(data));}
  function rememberCode(){if(!live||!code)return;try{localStorage.setItem('friday-code',JSON.stringify(code));sessionStorage.removeItem('friday-code');}catch{try{sessionStorage.setItem('friday-code',JSON.stringify(code));}catch{}}}
  function persistTonight(){try{if(tonight)localStorage.setItem('friday-tonight',JSON.stringify(tonight));else localStorage.removeItem('friday-tonight');}catch{}}
  function updatePeople(people){
    if(!Array.isArray(people)||!people.length||people.some(person=>typeof person!=='string'||!person.trim()||person.length>40))return;
    const selected=$('#name').value;
    names=[...new Set(people)];
    if(name&&!names.includes(name))name='';
    const options='<option value="">Choose your name</option>'+names.map(person=>`<option value="${escape(person)}">${escape(person)}</option>`).join('');
    $('#identity').innerHTML=options;$('#identity').value=name;
    $('#name').innerHTML=options;$('#name').value=names.includes(selected)?selected:name;
  }
  async function loadPeople(){
    const response=await fetch(config.supabaseUrl.replace(/\/$/,'')+'/rest/v1/rpc/watch_people',{method:'POST',headers:{apikey:config.supabasePublishableKey,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)});
    if(!response.ok)return;
    updatePeople(await response.json());render();
  }
  function initials(person){
    let length=1;
    while(length<3&&names.some(other=>other!==person&&other.toLowerCase().startsWith(person.slice(0,length).toLowerCase())))length++;
    return person.slice(0,length);
  }
  async function rpc(action, payload={}) {
    const response = await fetch(config.supabaseUrl.replace(/\/$/,'')+'/rest/v1/rpc/watch_api', {
      method:'POST',headers:{'Content-Type':'application/json',apikey:config.supabasePublishableKey},
      body:JSON.stringify({p_code:code,p_action:action,p_payload:payload}),signal:AbortSignal.timeout(15000)
    });
    const body = await response.json();
    if(!response.ok) throw new Error(body.message?.includes('Invalid group code')?'That group code didn’t work.': 'The shared list couldn’t be reached. Please try again.');
    return body;
  }
  async function load() {
    if(live) {if(!code)return;data=await rpc('list');rememberCode();updatePeople(data.people);}
    else {
      data=read(localStorage,'friday-demo',{items:structuredClone(window.WATCH_SEED),votes:[],people:[]});
      // Upgrade imported titles without resetting votes, watched flags, or additions.
      const reviewed=new Map(window.WATCH_SEED.map(item=>[item.id,item]));
      data.items=data.items.map(item=>{
        const match=reviewed.get(item.id);if(!match)return item;
        return {...item,title:match.title,type:match.type,original_title:match.original_title,lookup_title:match.lookup_title,notes:match.notes,match_status:match.match_status,year:match.year||item.year,imdb_id:match.imdb_id||item.imdb_id};
      });
      if(data.sampleVersion!==2){
        data.samplesInitialized=true;
        data.sampleVersion=2;
        data.votes=data.votes.filter(v=>!v.sample);
        const sampleSets=[
          ['hold','interested','idc',null,'interested','hold','idc'],
          ['pass','idc','interested','hold',null,'pass','interested'],
          [null,'hold','hold','interested','idc',null,'interested'],
          ['idc','pass',null,'idc','interested','hold','pass'],
          ['interested',null,'idc','hold','pass','interested',null],
          ['interested','hold','idc','pass',null,'interested','idc'],
          [null,'idc',null,'interested','hold','idc','interested'],
          ['hold','interested','pass',null,'idc','pass','hold']
        ];
        window.WATCH_SEED.forEach((item,index)=>{
          if(!data.items.some(i=>i.id===item.id))return;
          names.forEach((person,n)=>{
            const interest=sampleSets[index%sampleSets.length][n];
            if(!interest||data.votes.some(v=>v.item_id===item.id&&v.name===person))return;
            data.votes.push({item_id:item.id,name:person,interest,sample:true});
          });
        });
      }
      persistDemo();
    }
    if(name && !data.people.includes(name))data.people.push(name);
    render();
    void autoDetails();
  }
  async function mutate(action,payload) {
    const groupWatch=action==='watched'||(action==='progress'&&payload.name==='Group');
    if(groupWatch&&payload.watched){
      if(live&&data.watch_details_version!==2)throw new Error('The host needs to run the updated watch-history database update before recording group watches.');
      payload={...payload,attendees:tonight?[...tonight]:null,recorded_by:name||null,time_zone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'};
    }
    if(live) {
      if(syncing)throw new Error('Please wait for the current save to finish.');
      syncing=true;
      try {await rpc(action,payload);await load();}finally{syncing=false;}
      return;
    }
    if(action==='add')for(const item of payload.items){if(!data.items.some(x=>x.type===item.type&&[x.title,x.original_title].some(t=>t?.toLowerCase()===item.title.toLowerCase())))data.items.push({...item,id:crypto.randomUUID(),watched:false,created_at:new Date().toISOString()});}
    if(action==='vote') {data.votes=data.votes.filter(v=>!(v.item_id===payload.id&&v.name===name));if(payload.interest)data.votes.push({item_id:payload.id,name,interest:payload.interest});}
    if(action==='watched'){
      const item=data.items.find(i=>i.id===payload.id);
      if(payload.watched&&!item.watched){
        Object.assign(item,demoWatchDetails(payload));
        data.seen ||= [];
        for(const person of item.watched_attendees||[])if(!data.seen.some(s=>s.item_id===item.id&&s.name===person))data.seen.push({item_id:item.id,name:person,created_at:item.watched_at});
      }
      if(!payload.watched)Object.assign(item,{watched_at:null,watched_on:null,watched_attendees:null,watched_by:null});
      item.watched=payload.watched;
    }
    if(action==='seen'){data.seen ||= [];if(!payload.seen)data.seen=data.seen.filter(s=>!(s.item_id===payload.id&&s.name===payload.name));else if(!data.seen.some(s=>s.item_id===payload.id&&s.name===payload.name))data.seen.push({item_id:payload.id,name:payload.name});}
    if(action==='progress'){
      data.progress ||= [];
      const existing=data.progress.find(p=>p.item_id===payload.id&&p.film===payload.film&&p.name===payload.name);
      if(!payload.watched)data.progress=data.progress.filter(p=>p!==existing);
      else if(!existing){
        data.progress.push({item_id:payload.id,film:payload.film,name:payload.name,...(groupWatch?demoWatchDetails(payload):{})});
        if(groupWatch)for(const person of payload.attendees||[])if(!data.progress.some(p=>p.item_id===payload.id&&p.film===payload.film&&p.name===person))data.progress.push({item_id:payload.id,film:payload.film,name:person});
      }
    }
    if(action==='details')Object.assign(data.items.find(i=>i.id===payload.id),payload.details);
    if(name&&!data.people.includes(name))data.people.push(name);
    persistDemo();render();
  }
  function demoWatchDetails(payload){
    const now=new Date();
    return {watched_at:now.toISOString(),watched_on:[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-'),watched_attendees:payload.attendees,watched_by:payload.recorded_by};
  }
  function watchDay(value){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return '';
    const [year,month,day]=value.split('-').map(Number);
    return new Date(year,month-1,day).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
  }
  function watchDetails(record){
    const day=watchDay(record?.watched_on);
    const attendees=Array.isArray(record?.watched_attendees)?record.watched_attendees:[];
    return `<small class="watch-details">${day?'Watched '+escape(day):'Watch date not recorded'}<br>${attendees.length?'With '+attendees.map(escape).join(', '):'Attendees not recorded'}${record?.watched_by?'<br>Marked by '+escape(record.watched_by):''}</small>`;
  }
  function groupProgressDetails(item,key){const record=(data.progress||[]).find(p=>p.item_id===item.id&&p.film===key&&p.name==='Group');return record?watchDetails(record):'';}
  function join() {$('#name').value=name;$('#code').value=code;$('#code-label').hidden=!live;$('#join-error').textContent='';$('#join-dialog').showModal();}
  function requireName() {if(!name){$('#identity').focus();toast('Choose your name at the top first.');return false;}if(live&&!code){join();return false;}return true;}
  function hasSeen(item){return item.members?item.members.some(hasSeen):!!name&&(data.seen||[]).some(s=>s.item_id===item.id&&s.name===name);}
  function buildCollections(){
    const normalize=title=>String(title||'').toLowerCase().replace(/(?:\s*\((?:\d{4}|rewatch)\))+\s*$/g,'').replace(/[^a-z0-9]/g,'');
    return (window.WATCH_COLLECTIONS||[]).map(group=>{
      const members=group.films.flatMap(([title,year])=>data.items.filter(item=>item.type==='movie'&&String(item.year)===String(year)&&[item.title,item.original_title].some(t=>normalize(t)===normalize(title))));
      if(!members.length)return null;
      return {id:'collection:'+group.id,title:group.title,type:'series',members,
        watched:members.every(i=>i.watched),poster_path:members.find(i=>i.poster_path)?.poster_path,
        created_at:members.map(i=>i.created_at).filter(Boolean).sort().at(-1),
        overview:''};
    }).filter(Boolean);
  }
  function findItem(id){return data.items.find(i=>i.id===id)||collections.find(i=>i.id===id);}
  function posterUrl(item){return typeof item.poster_path==='string'&&/^\/[\w.-]+$/.test(item.poster_path)?'https://image.tmdb.org/t/p/w500'+item.poster_path:'';}
  function collectionCard(item){
    const poster=posterUrl(item);
    return `<article class="card collection-card" data-id="${escape(item.id)}"><button type="button" class="poster ${poster?'':'fallback'}" data-open aria-label="Open ${escape(item.title)}" style="--poster-color:#ba02ee">${poster?`<img src="${poster}" alt="${escape(item.title)} collection" loading="lazy">`:'<span aria-hidden="true">M&amp;A</span>'}</button><div class="card-body"><h3><button class="title-link" data-open>${escape(item.title)}</button></h3><div class="meta"><span class="type-label">FILM SERIES</span><span>${item.members.length} films</span></div><button class="personal-seen" data-open>Choose a film</button><p class="description" title="${escape(item.overview)}">${escape(item.overview)}</p><div class="series-summary"><button class="series-progress-link" data-open>${completed(item,'Group')} of ${item.members.length} watched &middot; View films</button><p class="next-film">${escape(nextFilmLabel(item))}</p></div></div></article>`;
  }
  function voteEditActions(item,mine){return mine&&editingVote===item.id?'<div class="vote-edit-actions"><button type="button" class="secondary" data-cancel-vote>Cancel</button><button type="button" class="text-button" data-clear-vote>Clear response</button></div>':'';}

  function eligibleTonight(item){return tonight===null||!data.votes.some(v=>v.item_id===item.id&&(tonight.includes(v.name)?v.interest==='pass':v.interest==='hold'));}
  function matchesView(item){return view==='personal'?hasSeen(item):view==='watched'?item.watched||completed(item,'Group')>0:!item.watched;}
  function render() {
    $('#identity').value=name;
    $('#filters-panel').className='filters-panel'+(filtersOpen?' is-open':'');
    $('#filters-toggle').setAttribute('aria-expanded',String(filtersOpen));
    $('#filters-toggle').textContent=type==='all'?'Filters':'Filters · '+({movie:'Films',series:'Film series',tv:'TV shows'})[type];
    $('#grid').className='grid'+(layout==='grid'?' card-grid':'')+(showInitials?'':' hide-initials');
    $('#layout-list').setAttribute('aria-pressed',String(layout==='list'));
    $('#layout-grid').setAttribute('aria-pressed',String(layout==='grid'));
    $('#show-initials').checked=showInitials;
    $('#grid-hint').hidden=layout!=='grid';
    collections=buildCollections();
    const search=$('#search').value.toLowerCase().trim();
    const filteringTonight=view==='browse'&&tonight!==null;
    const responsePeople=filteringTonight?names.filter(person=>tonight.includes(person)):names;
    const grouped=type!=='movie'&&view!=='personal';
    const memberIds=new Set(grouped?collections.flatMap(c=>c.members.map(i=>i.id)):[]);
    const library=[...data.items.filter(i=>!memberIds.has(i.id)),...(grouped?collections:[])];
    const visible=library.filter(item=>{
      if(type!=='all'&&item.type!==type)return false;
      if(item.members)return item.members.some(member=>matchesView(member)&&(!filteringTonight||eligibleTonight(member))&&[item.title,member.title,member.original_title].some(t=>t?.toLowerCase().includes(search)));
      return [item.title,item.original_title,...films(item).map(f=>f[0])].some(t=>t?.toLowerCase().includes(search))&&matchesView(item)&&(!filteringTonight||eligibleTonight(item));
    });
    const assessment = item => {
      const ids=new Set(item.members?item.members.filter(i=>matchesView(i)&&(!filteringTonight||eligibleTonight(i))).map(i=>i.id):[item.id]);
      const votes=data.votes.filter(v=>ids.has(v.item_id));
      const score=new Set(votes.filter(v=>['interested','hold'].includes(v.interest)&&(tonight===null||tonight.includes(v.name))).map(v=>v.name)).size;
      return {votes,score};
    };
    const sort=$('#sort').value;
    visible.sort((a,b)=>sort==='title'?a.title.localeCompare(b.title):['oldest','unanswered'].includes(sort)?addedOrder(a)-addedOrder(b):addedOrder(b)-addedOrder(a));
    if(sort==='unanswered'){
      const responded=new Set(data.votes.filter(v=>v.name===name).map(v=>v.item_id));
      const answered=item=>item.members?item.members.every(i=>responded.has(i.id)):responded.has(item.id);
      visible.sort((a,b)=>Number(answered(a))-Number(answered(b)));
    }
    if(sort==='interest')visible.sort((a,b)=>assessment(b).score-assessment(a).score);
    $('#sample-notice').hidden=live||!data.votes.some(v=>v.sample);
    $('#tonight-status').hidden=!filteringTonight;
    $('#tonight-button').hidden=view!=='browse';
    $('#tonight-status').textContent=tonight?.length?`${visible.length} eligible titles · ${tonight.length} joining${sort==='interest'?' · Group interest':''}`:'Select at least one person to see their picks.';
    $('#tonight-status').setAttribute('title',tonight?.join(', ')||'');
    $('#empty').textContent=view==='personal'?(!name?'Choose your name to see your watch history.':data.items.some(hasSeen)?'No seen titles match this category or search.':'Nothing here yet. Mark titles as seen to add them to your history.'):filteringTonight?'No matching picks. Select more people, or clear the selection.':'No titles here. Try another category or search.';

    $('#count').textContent=visible.length;$('#count').hidden=view!=='browse';$('#empty').hidden=!!visible.length;
    $('#grid').innerHTML=visible.map((item,index)=>{
      if(item.members)return collectionCard(item);
      const {votes}=assessment(item), mine=votes.find(v=>v.name===name)?.interest;
      const seen=hasSeen(item);
      const holds=votes.filter(v=>v.interest==='hold').map(v=>v.name), interested=votes.filter(v=>v.interest==='interested').map(v=>v.name), passes=votes.filter(v=>v.interest==='pass').map(v=>v.name);
      const poster=typeof item.poster_path==='string'&&/^\/[\w.-]+$/.test(item.poster_path)?`https://image.tmdb.org/t/p/w500${item.poster_path}`:'';
      const imdb=/^tt\d+$/.test(item.imdb_id||'')?`<a href="https://www.imdb.com/title/${item.imdb_id}/" target="_blank" rel="noopener">IMDb ↗</a>`:'';
      const tmdb=Number.isInteger(Number(item.tmdb_id))&&Number(item.tmdb_id)>0?`<a href="https://www.themoviedb.org/${item.type==='series'?'collection':item.type==='tv'?'tv':'movie'}/${Number(item.tmdb_id)}" target="_blank" rel="noopener">TMDB ↗</a>`:'';
      return `<article class="card ${item.members?'collection-card':''}" data-id="${escape(item.id)}"><button type="button" data-open aria-label="Open ${escape(item.title)}" class="poster ${poster?'':'fallback'}" style="--poster-color:${['#ba02ee','#4502ee','#ee02ab','#ba02ee','#4502ee'][index%5]}">${poster?`<img src="${poster}" alt="${escape(item.title)} poster" loading="lazy">`:`<span aria-hidden="true">${escape(item.title.slice(0,1).toUpperCase())}</span>`}</button><div class="card-body"><h3><button class="title-link" data-open>${escape(displayTitle(item))}</button></h3><div class="meta"><span class="type-label">${types[item.type]||'FILM'}</span>${item.year?`<span>${escape(item.year)}</span>`:''}${item.watched&&watchDay(item.watched_on)?'<span>Watched '+escape(watchDay(item.watched_on))+'</span>':''}${item.watched?'<span>Watched ✓</span>':''}${item.members?`<span>${item.members.length} films</span>`:`<span class="added-date">${dateLabel(item)}</span>`}</div>${item.members?'<button class="personal-seen" data-open>Choose a film</button>':`<button class="personal-seen" data-seen aria-pressed="${seen}" aria-label="${escape((seen?'Mark as not seen: ':'Mark as seen: ')+displayTitle(item)+(name?' for '+name:''))}" title="${escape(seen?'Seen by '+name+' — click to undo':name?'Mark as seen by '+name:'Choose your name first')}">${seen?'✓ Seen':'Mark as seen'}</button>`}${item.overview?`<p class="description">${escape(item.overview)}</p>`:''}<div class="vote-controls response-panel" role="group" aria-label="Responses to ${escape(item.title)}"><div class="people-responses">${responsePeople.map(person=>votes.find(v=>v.name===person)||{name:person,interest:'unanswered'}).map(v=>`<span class="person-response response-${v.interest}" tabindex="0" role="img" aria-label="${escape(v.name)}: ${voteLabels[v.interest]||'Not answered'}${v.sample?' (sample)':''}" data-label="${escape(v.name)}: ${voteLabels[v.interest]||'Not answered'}${v.sample?' (sample)':''}">${escape(initials(v.name))}</span>`).join('')||'<span class="no-response">No responses yet</span>'}</div>${mine&&editingVote!==item.id?`<div class="saved-response response-${mine}"><span>Your pick: ${escape(voteLabels[mine])}</span><span aria-hidden="true">&middot;</span><button class="edit-response" aria-label="Edit your response" title="Edit your response" data-edit-vote>Edit</button><small class="vote-consequence">${escape(voteHints[mine])}</small></div>`:`<div class="response-buttons">${Object.entries(voteLabels).map(([value,label])=>`<button data-vote="${value}" title="${escape(voteHints[value])}" aria-pressed="${mine===value}">${label}</button>`).join('')}</div>`}${voteEditActions(item,mine)}</div><div class="series-summary">${films(item).length?`<button class="series-progress-link" data-open>${films(item).length} films &middot; ${completed(item,'Group')} watched &middot; View films</button><p class="next-film">${escape(nextFilmLabel(item))}</p>`: ''}</div></div></article>`;
    }).join('');
    $('#attendees').innerHTML=names.length?names.map(n=>`<label class="check-label"><input type="checkbox" value="${escape(n)}" ${draftTonight.includes(n)?'checked':''}>${escape(n)}</label>`).join(''):'<p>Your friends appear here once they join and vote.</p>';
    $('#tonight-button').textContent=tonight===null?'Who’s here tonight?':`Tonight: ${tonight.length} joining`;
  }
  function openAdd(item=null) {
    if(!requireName())return;
    clearTimeout(lookupTimer);lookupRequest++;
    editing=item;results=[];$('#results').replaceChildren();$('#lookup').value=item?.lookup_title||item?.title||'';$('#add-type').value=item?.type||'movie';$('#add-type').disabled=!!item;if(!live)$('#quick-form').prepend($('#add-type'));
    $('#quick-form').hidden=!!item;$('#quick-titles').value='';$('#add-heading').textContent=item?'Find the right match':'Add a title';$('#lookup-status').textContent='';$('#add-error').textContent='';$('#add-dialog').showModal();
    $('#match-queue').hidden=!matchQueue.length;
    $('#match-queue-status').textContent=matchQueue.length?`${matchQueue.length} unmatched titles left. Choose a match or skip for now.`:'';
    if(item&&live)void searchTitles();
  }
  async function metadata(payload) {
    if(!live)throw new Error('Poster lookup becomes available after connecting Supabase and a TMDB key. Quick add works in this preview.');
    const response=await fetch(config.supabaseUrl.replace(/\/$/,'')+'/functions/v1/metadata',{method:'POST',headers:{'Content-Type':'application/json',apikey:config.supabasePublishableKey},body:JSON.stringify({...payload,code}),signal:AbortSignal.timeout(15000)});
    const body=await response.json();if(!response.ok)throw new Error(body.error||'Title lookup is unavailable. You can still quick add.');return body;
  }
  $('#join-form').addEventListener('submit',async event=>{
    event.preventDefault();const button=event.submitter||$('#join-form button[type="submit"]');button.disabled=true;$('#join-error').textContent='';
    const oldCode=code;code=$('#code').value.trim();
    try{if(live){data=await rpc('list');updatePeople(data.people);}name=$('#name').value.trim().replace(/\s+/g,' ');if(!name)throw new Error('Please enter a name.');localStorage.setItem('friday-name',JSON.stringify(name));rememberCode();if(!data.people.includes(name))data.people.push(name);$('#join-dialog').close();render();}
    catch(error){code=oldCode;$('#join-error').textContent=error.message;}finally{button.disabled=false;}
  });
  function forgetDevice(){localStorage.removeItem('friday-name');localStorage.removeItem('friday-code');sessionStorage.removeItem('friday-code');name='';code='';if(live)data={items:[],votes:[],people:[]};document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());render();}
  $('#leave').onclick=forgetDevice;
  $('#forget-device').onclick=forgetDevice;
  $('#forget-device').hidden=!live;
  $('#identity').onchange=()=>{
    editingVote=null;
    const selected=$('#identity').value;
    if(live&&!code){$('#name').value=selected;$('#code-label').hidden=false;$('#join-error').textContent='';$('#join-dialog').showModal();return;}
    name=selected;localStorage.setItem('friday-name',JSON.stringify(name));
    if(name&&!data.people.includes(name))data.people.push(name);
    render();
  };
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
  document.querySelectorAll('dialog').forEach(dialog=>{
    let startedOutside=false;
    const outside=event=>{const r=dialog.getBoundingClientRect();return event.target===dialog&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom);};
    dialog.addEventListener('pointerdown',event=>{startedOutside=outside(event);});
    dialog.addEventListener('pointercancel',()=>{startedOutside=false;});
    dialog.addEventListener('click',event=>{if(startedOutside&&outside(event))dialog.close();startedOutside=false;});
  });
  document.querySelectorAll('[data-type]').forEach(b=>b.onclick=()=>{type=b.dataset.type;document.querySelectorAll('[data-type]').forEach(x=>x.setAttribute('aria-pressed',x===b));render();});
  $('#search').addEventListener('input',render);
  $('#filters-toggle').onclick=()=>{filtersOpen=!filtersOpen;render();};
  function setLayout(value){layout=value;try{localStorage.setItem('friday-layout',JSON.stringify(value));}catch{}render();}
  $('#layout-list').onclick=()=>setLayout('list');
  $('#layout-grid').onclick=()=>setLayout('grid');
  $('#show-initials').addEventListener('change',()=>{showInitials=$('#show-initials').checked;try{localStorage.setItem('friday-show-initials',JSON.stringify(showInitials));}catch{}render();});
  $('#sort').addEventListener('change',()=>{
    try{localStorage.setItem('friday-sort',JSON.stringify($('#sort').value));}catch{}
    render();
  });
  $('#help-button').onclick=()=>$('#help-dialog').showModal();
  $('#add-button').onclick=()=>{matchQueue=[];openAdd();};
  $('#tonight-button').onclick=()=>{const panel=$('#tonight-panel');panel.hidden=!panel.hidden;if(!panel.hidden)draftTonight=[...(tonight||[])];$('#tonight-button').setAttribute('aria-expanded',String(!panel.hidden));render();};
  $('#attendees').onchange=()=>{draftTonight=Array.from($('#attendees').querySelectorAll('input:checked')).map(x=>x.value);render();};
  $('#remove-samples').onclick=()=>{data.votes=data.votes.filter(v=>!v.sample);persistDemo();render();};
  $('#attendees-all').onclick=()=>{draftTonight=[...names];render();};
  $('#attendees-main').onclick=()=>{draftTonight=names.filter(person=>['Alex','Lyss','Julie','Blue','Ashe','Amanda','Emi'].includes(person));render();};
  $('#attendees-none').onclick=()=>{draftTonight=[];tonight=null;persistTonight();render();};
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;document.querySelectorAll('[data-view]').forEach(x=>x.setAttribute('aria-pressed',x===b));$('#tonight-panel').hidden=true;$('#tonight-button').setAttribute('aria-expanded','false');render();});
  $('#tonight-apply').onclick=()=>{
    tonight=draftTonight.length?[...draftTonight]:null;persistTonight();
    if(tonight){$('#sort').value='interest';try{localStorage.setItem('friday-sort',JSON.stringify('interest'));}catch{}}
    $('#tonight-panel').hidden=true;$('#tonight-button').setAttribute('aria-expanded','false');render();$('#tonight-button').focus();
  };
  $('#refresh').onclick=async()=>{try{if(live&&!code){join();return;}await load();toast('List refreshed.');}catch(e){toast(e.message);}};
  $('#grid').onclick=async event=>{
    const button=event.target.closest('button');if(!button)return;
    const item=findItem(button.closest('[data-id]').dataset.id);if(!item)return;
    if(button.hasAttribute('data-open')){openDetail(item);return;}
    if(!requireName())return;
    if(button.hasAttribute('data-edit-vote')){editingVote=item.id;render();document.querySelector(`[data-id="${item.id}"] [data-vote]`)?.focus();return;}
    const current=data.votes.find(v=>v.item_id===item.id&&v.name===name)?.interest;
    if(button.hasAttribute('data-cancel-vote')||(button.dataset.vote&&button.dataset.vote===current)){
      editingVote=null;render();document.querySelector(`[data-id="${item.id}"] [data-edit-vote]`)?.focus();return;
    }
    button.disabled=true;
    try{if(button.dataset.vote||button.hasAttribute('data-clear-vote')){editingVote=null;await mutate('vote',{id:item.id,name,interest:button.hasAttribute('data-clear-vote')?null:button.dataset.vote});}
    else if(button.hasAttribute('data-seen')){await mutate('seen',{id:item.id,name,seen:!hasSeen(item)});document.querySelector(`[data-id="${item.id}"] [data-seen]`)?.focus();}
    else if(button.hasAttribute('data-watched'))await mutate('watched',{id:item.id,watched:!item.watched});}
    catch(error){toast(error.message);}finally{button.disabled=false;}
  };
  $('#quick-form').onsubmit=async event=>{
    event.preventDefault();if(quickAdding||lookupSaving)return;const button=event.submitter||$('#quick-submit');const titles=[...new Set($('#quick-titles').value.split(/\r?\n/).map(t=>t.trim()).filter(Boolean))];
    if(!titles.length||titles.length>100||titles.some(t=>t.length>200)){ $('#add-error').textContent='Add 1–100 titles, each under 200 characters.';return;}
    const items=titles.map(title=>({title,type:$('#add-type').value}));
    const label=button.textContent;let matched=0,lookupFailed=false;
    button.disabled=true;quickAdding=true;$('#add-error').textContent='';
    try{
      if(live)for(const [index,item] of items.entries()){
        button.textContent=`Matching ${index+1} of ${items.length}…`;
        try{const details=await metadata({action:'resolve',type:item.type,title:item.title});if(details){Object.assign(item,details);matched++;}}
        catch{lookupFailed=true;break;}
      }
      button.textContent='Adding…';await mutate('add',{items});$('#quick-titles').value='';
      matchQueue=live&&!lookupFailed?items.filter(i=>!i.tmdb_id).map(i=>data.items.find(saved=>saved.type===i.type&&saved.title.toLowerCase()===i.title.toLowerCase()&&!saved.tmdb_id)).filter(Boolean):[];
      if(matchQueue.length)openAdd(matchQueue[0]);
      toast(!live?'Added to the list. Existing titles were skipped.':lookupFailed?'Titles added. Lookup is unavailable; details can be matched later.':`${matched} of ${items.length} titles matched. Added to the list; existing titles were skipped.`);
    }catch(e){$('#add-error').textContent=e.message;}finally{button.disabled=false;button.textContent=label;quickAdding=false;}
  };
  async function searchTitles(){
    clearTimeout(lookupTimer);
    const request=++lookupRequest,query=$('#lookup').value.trim(),searchType=$('#add-type').value;
    results=[];$('#results').replaceChildren();$('#add-error').textContent='';
    if(!query){$('#lookup-status').textContent='';return;}
    $('#lookup-status').textContent='Looking for matches…';
    try{
      const found=await metadata({action:'search',query,type:searchType});
      if(request!==lookupRequest)return;
      results=found;$('#lookup-status').textContent=results.length?'Choose a match below. You can keep adding titles here.':'No matches. Try another title, or add without a match below.';
      $('#results').innerHTML=results.map((r,i)=>`<button type="button" class="result" data-result="${i}">${typeof r.poster_path==='string'&&/^\/[\w.-]+$/.test(r.poster_path)?`<img src="https://image.tmdb.org/t/p/w185${r.poster_path}" alt="" loading="lazy">`:'<span class="result-placeholder" aria-hidden="true">No poster</span>'}<span><strong>${escape(r.title)}</strong><small>${escape(r.year||'')} · ${escape(r.overview?.slice(0,140)||'No description available')}</small></span></button>`).join('');
    }catch(e){if(request===lookupRequest)$('#lookup-status').textContent=e.message;}
  }
  $('#lookup-form').onsubmit=event=>{event.preventDefault();return searchTitles();};
  $('#lookup').addEventListener('input',()=>{
    clearTimeout(lookupTimer);lookupRequest++;results=[];$('#results').replaceChildren();
    lookupTimer=setTimeout(()=>void searchTitles(),350);
  });
  $('#add-type').addEventListener('change',()=>{if(live)void searchTitles();});
  function nextMatch(){
    matchQueue.shift();
    if(matchQueue.length)openAdd(matchQueue[0]);else{openAdd();toast('Matching finished. You can add more titles.');}
  }
  $('#skip-match').onclick=()=>{if(!lookupSaving)nextMatch();};
  $('#add-dialog').addEventListener('close',()=>{clearTimeout(lookupTimer);lookupRequest++;matchQueue=[];});
  $('#results').onclick=async event=>{
    const button=event.target.closest('[data-result]');if(!button||button.disabled||lookupSaving||quickAdding)return;
    const result=results[Number(button.dataset.result)],target=editing,addType=$('#add-type').value;
    if(!result)return;
    lookupSaving=true;$('#results').querySelectorAll('button').forEach(b=>b.disabled=true);button.disabled=true;
    try{const details=await metadata({action:'details',id:result.tmdb_id,type:addType});
      if(target)await mutate('details',{id:target.id,details});else await mutate('add',{items:[{...details,title:result.title,type:addType}]});
      if(matchQueue.length)nextMatch();else if(target)$('#add-dialog').close();
      else{lookupRequest++;$('#lookup').value='';results=[];$('#results').replaceChildren();$('#lookup-status').textContent=`Added ${result.title}. Search for another title.`;$('#lookup').focus();}
      toast(target?'Details updated.':'Added to the list.');
    }catch(e){$('#add-error').textContent=e.message;}finally{lookupSaving=false;button.disabled=false;$('#results').querySelectorAll('button').forEach(b=>b.disabled=false);}
  };

  function addedOrder(item){return Date.parse(item.created_at)||window.WATCH_SEED.findIndex(i=>i.id===item.id)+1;}
  function dateLabel(item){return item.created_at?'Added '+new Date(item.created_at).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):(window.WATCH_SEED.some(i=>i.id===item.id)?'Original list · #'+(window.WATCH_SEED.findIndex(i=>i.id===item.id)+1):'Added before date tracking');}
  function displayTitle(item){return item.title==='The Princess Diaries 2: Royal Engagement'?'The Princess Diaries':item.title==='Glass Onion: A Knives Out Mystery'?'Knives Out':item.title;}
  function films(item){return item.members?item.members.map(i=>[i.title,Number(i.year)]):item.type==='series'?(window.WATCH_SERIES[item.title]||item.films||[]):[];}
  function nextFilmLabel(item){
    if(item.members){
      const next=item.members.find(member=>!member.watched&&(view!=='browse'||eligibleTonight(member)));
      return next?'Next: '+filmKey([next.title,next.year]):item.watched?'All films watched by the group':'No remaining films eligible tonight';
    }
    const next=films(item).find(f=>!done(item,f,'Group'));
    return next?'Next: '+filmKey(next):'All films watched by the group';
  }
  function filmKey(f){return f[0]+' ('+f[1]+')';}
  function done(item,f,person){
    if(item.members){const member=item.members.find(i=>filmKey([i.title,Number(i.year)])===filmKey(f));return person==='Group'?!!member?.watched:!!member&&(data.seen||[]).some(s=>s.item_id===member.id&&s.name===person);}
    return (data.progress||[]).some(p=>p.item_id===item.id&&p.film===filmKey(f)&&p.name===person);
  }
  function completed(item,person){return films(item).filter(f=>done(item,f,person)).length;}
  function openDetail(item){filmFilter=item.members&&view==='watched'?'watched':'all';detailId=item.id;renderDetail();if(!$('#detail-dialog').open)$('#detail-dialog').showModal();if(item.type==='tv'&&item.tmdb_id&&live)void loadTv(item);if(item.type==='series'&&!item.members)void loadFilmMetadata(item);}
  function filmInfo(f){return {...data.items.find(i=>i.type==='movie'&&i.title===f[0]&&String(i.year)===String(f[1])),...filmMetadata.get(filmKey(f))};}
  function filmHref(f,details){return Number.isSafeInteger(Number(details.tmdb_id))&&Number(details.tmdb_id)>0?'https://www.themoviedb.org/movie/'+Number(details.tmdb_id):'https://www.themoviedb.org/search/movie?query='+encodeURIComponent(filmKey(f));}
  function filmPoster(f,details){const poster=posterUrl(details);return poster?`<img src="${poster}" alt="" loading="lazy">`:`<span aria-hidden="true">${escape(f[0].slice(0,1))}</span>`;}
  function seriesFilmCard(item,f,index){
    const details=filmInfo(f),href=filmHref(f,details);
    return `<article class="film-row series-film-card" data-film-card="${index}"><a class="series-film-poster" href="${escape(href)}" target="_blank" rel="noopener" aria-label="Details for ${escape(filmKey(f))}">${filmPoster(f,details)}</a><div class="series-film-info"><h4><a class="series-film-title title-link" href="${escape(href)}" target="_blank" rel="noopener">${escape(f[0])}</a></h4><div class="meta"><span class="type-label">FILM</span><span>${escape(f[1])}</span></div><p class="series-film-synopsis" ${details.overview?'':'hidden'}>${escape(details.overview||'')}</p>${groupProgressDetails(item,filmKey(f))}</div><div class="film-watch-controls">`+
      ['Group',name].map(person=>`<label class="film-watch-control ${done(item,f,person)?'is-watched':''}"><input type="checkbox" data-film="${index}" data-person="${escape(person)}" ${done(item,f,person)?'checked':''} ${!name?'disabled':''}><span>${person==='Group'?'Group watched':'Seen by '+escape(person||'you')}</span><span class="sr-only">: ${escape(filmKey(f))}</span></label>`).join('')+'</div></article>';
  }
  function paintFilmMetadata(item,key){
    if(detailId!==item.id||!$('#detail-dialog').open)return;
    // Update imagery and text in place; leave checkboxes, focus and scroll untouched.
    $('#detail-content').querySelectorAll('[data-film-card]').forEach(card=>{
      const f=films(item)[Number(card.dataset.filmCard)];if(!f||filmKey(f)!==key)return;
      const details=filmInfo(f),poster=card.querySelector('.series-film-poster'),synopsis=card.querySelector('.series-film-synopsis');
      poster.innerHTML=filmPoster(f,details);poster.href=filmHref(f,details);
      card.querySelector('.series-film-title').href=poster.href;
      synopsis.textContent=details.overview||'';synopsis.hidden=!details.overview;
    });
  }
  async function loadFilmMetadata(item){
    if(!live)return;
    const pending=films(item).filter(f=>!filmMetadata.has(filmKey(f))&&!filmInfo(f).poster_path);
    async function worker(){
      while(pending.length){
        const f=pending.shift(),key=filmKey(f);
        if(!filmLookups.has(key))filmLookups.set(key,metadata({action:'resolve',type:'movie',title:f[0],year:String(f[1])}).then(details=>{filmMetadata.set(key,details||{});}).finally(()=>filmLookups.delete(key)));
        try{await filmLookups.get(key);paintFilmMetadata(item,key);}catch{break;}
      }
    }
    await Promise.all([worker(),worker()]);
  }
  function episodeKey(item,season,episode){return `tv:${item.tmdb_id}:${season}:${episode}`;}
  function episodeDone(item,season,episode,person){return (data.progress||[]).some(p=>p.item_id===item.id&&p.name===person&&p.film===episodeKey(item,season,episode));}
  function seasonCount(item,season,person){return (data.progress||[]).filter(p=>p.item_id===item.id&&p.name===person&&p.film.startsWith(`tv:${item.tmdb_id}:${season}:`)).length;}
  async function loadTv(item,season){
    let state=tvShows.get(item.tmdb_id);
    if(!state){state={seasons:null,episodes:new Map(),selected:null,request:0,loading:false,error:'',saving:false};tvShows.set(item.tmdb_id,state);}
    if(season!==undefined)state.selected=season;
    const request=++state.request;state.loading=true;state.error='';
    const repaint=()=>{if(detailId===item.id&&$('#detail-dialog').open)renderDetail();};
    repaint();
    try{
      if(!state.seasons)state.seasons=await metadata({action:'seasons',type:'tv',id:Number(item.tmdb_id)});
      if(request!==state.request)return;
      if(state.selected===null)state.selected=state.seasons.find(s=>s.number>0&&seasonCount(item,s.number,'Group')<s.episode_count)?.number??state.seasons[0]?.number??null;
      const selected=state.selected;
      if(selected!==null&&!state.episodes.has(selected)){
        const episodes=await metadata({action:'episodes',type:'tv',id:Number(item.tmdb_id),season:selected});
        state.episodes.set(selected,episodes);
      }
    }catch(e){if(request===state.request)state.error=e.message;}
    finally{if(request===state.request){state.loading=false;repaint();}}
  }
  function tvTracker(item){
    if(item.type!=='tv')return '';
    const heading='<section class="tv-tracker" aria-label="Episode progress"><h3>Episode progress</h3>';
    if(!live)return heading+'<p class="hint">Season and episode lists are available on the shared site.</p></section>';
    if(!item.tmdb_id)return heading+'<p class="hint">Find a match above to load this show’s seasons and episodes.</p></section>';
    const state=tvShows.get(item.tmdb_id);
    if(!state)return heading+'<p class="hint" role="status">Loading seasons…</p></section>';
    const seasons=state.seasons||[],episodes=state.episodes.get(state.selected)||[];
    const picker=seasons.length?'<label class="season-picker">Season<select data-season aria-label="Season">'+seasons.map(s=>`<option value="${s.number}" ${s.number===state.selected?'selected':''}>${escape(s.name)} · ${seasonCount(item,s.number,'Group')}/${s.episode_count} group watched</option>`).join('')+'</select></label>':'';
    if(state.error)return heading+picker+`<p class="error" role="alert">${escape(state.error)}</p><button class="secondary" data-tv-retry>Try again</button></section>`;
    if(state.loading)return heading+picker+'<p class="hint" role="status">Loading episodes…</p></section>';
    if(!episodes.length)return heading+picker+'<p class="hint">No episodes listed yet.</p></section>';
    const count=person=>episodes.filter(e=>episodeDone(item,state.selected,e.number,person)).length;
    const next=episodes.find(e=>!episodeDone(item,state.selected,e.number,'Group'));
    const summary=`<div class="episode-counts"><span>Group <b>${count('Group')}/${episodes.length}</b></span>${name?`<span>${escape(name)} <b>${count(name)}/${episodes.length}</b></span>`:''}</div><p class="hint">${next?`Next for the group: episode ${next.number} · ${escape(next.name)}`:'Season complete for the group ✓'}</p>`;
    return heading+picker+summary+'<div class="progress-heading"><span>Episode</span><span>Group</span><span>'+escape(name||'You')+'</span></div>'+episodes.map(e=>`<div class="film-row episode-row"><span><b><span class="episode-number">${e.number}.</span> ${escape(e.name)}</b>${groupProgressDetails(item,episodeKey(item,state.selected,e.number))}${e.air_date&&e.air_date>new Date().toISOString().slice(0,10)?`<small>Upcoming · ${escape(e.air_date)}</small>`:''}</span>`+['Group',name].map(person=>`<label><span class="sr-only">Season ${state.selected}, episode ${e.number} watched by ${escape(person||'you')}</span><input type="checkbox" data-episode="${e.number}" data-season-number="${state.selected}" data-person="${escape(person)}" ${episodeDone(item,state.selected,e.number,person)?'checked':''} ${!name||state.saving?'disabled':''}></label>`).join('')+'</div>').join('')+'</section>';
  }
  function filmFilterControls(){return '<div class="film-filters" role="group" aria-label="Film progress filter">'+['all','remaining','watched'].map(value=>`<button class="secondary" data-film-filter="${value}" aria-pressed="${filmFilter===value}">${{all:'All films',remaining:'Remaining',watched:'Watched'}[value]}</button>`).join('')+'</div>';}
  function renderCollectionDetail(item){
    const members=item.members.filter(member=>filmFilter==='all'||(filmFilter==='watched')===!!member.watched);
    $('#detail-content').innerHTML=`<p class="eyebrow">FILM SERIES</p><h2>${escape(item.title)}</h2><p>${escape(item.overview)}</p><p class="hint">${completed(item,'Group')} of ${item.members.length} watched by the group. ${escape(nextFilmLabel(item))}</p>${filmFilterControls()}<p class="hint">Check Group to mark a film group watched, or your name to mark it personally seen. Each film keeps its own responses.</p><div class="progress-heading"><span>Film</span><span>Group</span><span>${escape(name||'You')}</span></div>`+
      members.map(member=>`<div class="film-row collection-film"><span><button class="title-link" data-member-open="${escape(member.id)}">${escape(member.title)}</button><small>${escape(member.year)}</small>${member.watched?watchDetails(member):''}${view==='browse'&&tonight!==null&&!eligibleTonight(member)?'<small class="warning">Not eligible tonight</small>':''}</span>`+['Group',name].map(person=>`<label><span class="sr-only">${escape(member.title)} watched by ${escape(person||'you')}</span><input type="checkbox" data-member-id="${escape(member.id)}" data-person="${escape(person)}" ${person==='Group'?member.watched?'checked':'':(data.seen||[]).some(s=>s.item_id===member.id&&s.name===person)?'checked':''} ${!name?'disabled':''}></label>`).join('')+'</div>').join('')+
      (!members.length?'<p class="hint">No films in this filter yet.</p>':'');
  }
  function detailResponses(item){
    const mine=data.votes.find(v=>v.item_id===item.id&&v.name===name)?.interest;
    return `<section class="detail-responses"><h3>Your response${name?' · '+escape(name):''}</h3><div class="response-panel"><div class="response-buttons">${Object.entries(voteLabels).map(([value,label])=>`<button type="button" data-detail-vote="${value}" data-vote="${value}" title="${escape(voteHints[value])}" aria-pressed="${mine===value}">${label}</button>`).join('')}</div></div>${mine?'<button type="button" class="text-button" data-detail-clear>Clear response</button>':''}${item.members?'':`<button type="button" class="personal-seen" data-detail-seen aria-pressed="${hasSeen(item)}">${hasSeen(item)?'Seen — click to undo':'Mark as seen'}</button>`}</section>`;
  }
  function renderDetail(){
    const item=findItem(detailId);if(!item)return;
    if(item.members){renderCollectionDetail(item);return;}
    const parent=collections.find(c=>c.members.some(i=>i.id===item.id));
    const list=films(item);
    const shown=list.map((film,index)=>({film,index})).filter(({film})=>filmFilter==='all'||(filmFilter==='watched')===done(item,film,'Group'));
    $('#detail-content').innerHTML=(parent?`<p><button class="secondary" data-collection-back="${escape(parent.id)}">Back to ${escape(parent.title)}</button></p>`:'')+'<p class="eyebrow">'+types[item.type]+'</p><h2>'+escape(displayTitle(item))+'</h2><p class="detail-meta">'+dateLabel(item)+'</p>'+
      (item.overview?'<p>'+escape(item.overview)+'</p>':'')+
      (live&&!item.tmdb_id?'<p><button class="secondary" data-match>Find a match</button></p>':'')+
      (item.imdb_id?'<a href="https://www.imdb.com/title/'+escape(item.imdb_id)+'/" target="_blank" rel="noopener">View on IMDb ↗</a>':'')+tvTracker(item)+
      (list.length?'<h3>Series progress</h3><p class="hint">'+escape(nextFilmLabel(item))+'</p><div class="film-filters" role="group" aria-label="Film progress filter">'+['all','remaining','watched'].map(value=>'<button class="secondary" data-film-filter="'+value+'" aria-pressed="'+(filmFilter===value)+'">'+({all:'All films',remaining:'Remaining',watched:'Watched'})[value]+'</button>').join('')+'</div>'+shown.map(({film:f,index})=>seriesFilmCard(item,f,index)).join(''):'')+
      detailResponses(item)+'<div class="history-actions"><h3>Group watch history</h3><p class="hint">Move this '+(list.length?'series':'title')+' between the watch list and Watched.</p>'+(item.watched?watchDetails(item):'')+'<button class="secondary" data-archive>'+ (item.watched?'Move back to watch list':'Mark group watched')+'</button></div>';
  }
  $('#detail-content').onchange=async event=>{
    const memberInput=event.target.closest('[data-member-id]');
    if(memberInput){
      if(!requireName()){memberInput.checked=!memberInput.checked;return;}
      const member=data.items.find(i=>i.id===memberInput.dataset.memberId);if(!member)return;
      const person=memberInput.dataset.person,watched=memberInput.checked;
      $('#detail-content').querySelectorAll('[data-member-id]').forEach(input=>input.disabled=true);
      try{await mutate(person==='Group'?'watched':'seen',person==='Group'?{id:member.id,watched}:{id:member.id,name:person,seen:watched});}
      catch(e){toast(e.message);}finally{renderDetail();}
      return;
    }
    const tvItem=data.items.find(i=>i.id===detailId);
    if(event.target.matches('[data-season]')){void loadTv(tvItem,Number(event.target.value));return;}
    const episode=event.target.closest('[data-episode]');
    if(episode){
      if(!requireName()){episode.checked=!episode.checked;return;}
      const state=tvShows.get(tvItem.tmdb_id);state.saving=true;
      $('#detail-content').querySelectorAll('[data-episode]').forEach(input=>input.disabled=true);
      try{await mutate('progress',{id:tvItem.id,film:episodeKey(tvItem,Number(episode.dataset.seasonNumber),Number(episode.dataset.episode)),name:episode.dataset.person,watched:episode.checked});}
      catch(e){toast(e.message);}
      finally{state.saving=false;if(detailId===tvItem.id&&$('#detail-dialog').open)renderDetail();}
      return;
    }
    const input=event.target.closest('[data-film]');if(!input||!requireName())return;
    const item=data.items.find(i=>i.id===detailId);input.disabled=true;
    try{await mutate('progress',{id:item.id,film:filmKey(films(item)[Number(input.dataset.film)]),name:input.dataset.person,watched:input.checked});renderDetail();}catch(e){input.checked=!input.checked;toast(e.message);}finally{input.disabled=false;}
  };
  $('#detail-content').onclick=async event=>{
    const member=event.target.closest('[data-member-open]');if(member){openDetail(findItem(member.dataset.memberOpen));return;}
    const back=event.target.closest('[data-collection-back]');if(back){openDetail(findItem(back.dataset.collectionBack));return;}
    const response=event.target.closest('[data-detail-vote], [data-detail-seen], [data-detail-clear]');
    if(response){
      if(response.disabled||!requireName())return;
      const item=findItem(detailId);if(!item)return;
      const current=data.votes.find(v=>v.item_id===item.id&&v.name===name)?.interest;
      if(response.dataset.detailVote&&response.dataset.detailVote===current)return;
      $('#detail-content').querySelectorAll('[data-detail-vote], [data-detail-seen], [data-detail-clear]').forEach(button=>button.disabled=true);
      try{
        if(response.hasAttribute('data-detail-seen'))await mutate('seen',{id:item.id,name,seen:!hasSeen(item)});
        else{await mutate('vote',{id:item.id,name,interest:response.hasAttribute('data-detail-clear')?null:response.dataset.detailVote});}
      }catch(e){toast(e.message);}finally{renderDetail();}
      return;
    }
    const filter=event.target.closest('[data-film-filter]');if(filter){filmFilter=filter.dataset.filmFilter;renderDetail();return;}
    if(event.target.closest('[data-tv-retry]')){void loadTv(data.items.find(i=>i.id===detailId));return;}
    if(event.target.closest('[data-match]')){if(!requireName())return;const item=data.items.find(i=>i.id===detailId);$('#detail-dialog').close();openAdd(item);return;}
    const button=event.target.closest('[data-archive]');if(!button||!requireName())return;
    const item=data.items.find(i=>i.id===detailId);button.disabled=true;
    try{await mutate('watched',{id:item.id,watched:!item.watched});$('#detail-dialog').close();}catch(e){toast(e.message);}finally{button.disabled=false;}
  };
  async function autoDetails(){
    if(!live||!code||autoRunning||quickAdding)return;autoRunning=true;
    try{for(const item of data.items){
      if(item.type==='series'&&(window.WATCH_COLLECTIONS||[]).some(group=>group.title.toLowerCase()===item.title.toLowerCase()))continue;
      if(item.tmdb_id||attempted.has(item.id)||item.match_status==='needs_confirmation')continue;
      attempted.add(item.id);
      try{const details=await metadata({action:'resolve',type:item.type,imdb_id:item.imdb_id,title:item.lookup_title||displayTitle(item),year:item.year});
        if(details){await rpc('details',{id:item.id,details});Object.assign(item,details);}
      }catch{attempted.delete(item.id);break;}
    }if(!document.querySelector('dialog[open]'))render();}finally{autoRunning=false;}
  }

  $('#lookup-form').hidden=!live;
  if(live)void loadPeople().catch(()=>{});
  load().catch(e=>{toast(e.message);join();});
  if(live&&!code)join();
  // Refresh between interactions; never repaint an open form or an active write.
  setInterval(async()=>{if(!live||!code||document.hidden||document.querySelector('dialog[open]')||syncing||document.activeElement?.closest('.card'))return;syncing=true;try{await load();}catch{}finally{syncing=false;}},30000);
})();
