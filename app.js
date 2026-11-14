/* No build step or browser dependencies. Shared writes always go through the code-gated RPC. */
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const config = window.WATCH_CONFIG || {};
  const live = !!(config.supabaseUrl && config.supabasePublishableKey);
  const types = {movie:'FILM',series:'FILM SERIES',tv:'TV SHOW'};
  const voteLabels = {hold:'Absolutely',interested:'Yes',idc:'IDC',pass:'Nope !'};
  const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const read = (storage, key, fallback) => {try {return JSON.parse(storage.getItem(key)) ?? fallback;} catch {return fallback;}};
  const savedSort=read(localStorage,'friday-sort','oldest');
  $('#sort').value=['oldest','newest','title','interest','unanswered'].includes(savedSort)?savedSort:'oldest';
  let name = read(localStorage, 'friday-name', '');
  const names = ["Alex","Lyss","Julie","Blue","Ashe","Amanda","Emi"];
  if(!names.includes(name))name='';
  let code = read(sessionStorage, 'friday-code', '');
  let data = {items:[],votes:[],people:[]}, type = 'all', tonight = null, editing = null, results = [], syncing = false;
  let draftTonight=[];
  let editingVote=null;
  let view='browse', detailId=null, autoRunning=false, quickAdding=false;
  const attempted=new Set();
  let toastTimer;
  const toast = message => {$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,4500);};
  function persistDemo() {localStorage.setItem('friday-demo',JSON.stringify(data));}
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
    if(live) {if(!code)return;data=await rpc('list');}
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
    if(live) {
      if(syncing)throw new Error('Please wait for the current save to finish.');
      syncing=true;
      try {await rpc(action,payload);await load();}finally{syncing=false;}
      return;
    }
    if(action==='add')for(const item of payload.items){if(!data.items.some(x=>x.type===item.type&&[x.title,x.original_title].some(t=>t?.toLowerCase()===item.title.toLowerCase())))data.items.push({...item,id:crypto.randomUUID(),watched:false,created_at:new Date().toISOString()});}
    if(action==='vote') {data.votes=data.votes.filter(v=>!(v.item_id===payload.id&&v.name===name));if(payload.interest)data.votes.push({item_id:payload.id,name,interest:payload.interest});}
    if(action==='watched')data.items.find(i=>i.id===payload.id).watched=payload.watched;
    if(action==='progress'){data.progress ||= [];data.progress=data.progress.filter(p=>!(p.item_id===payload.id&&p.film===payload.film&&p.name===payload.name));if(payload.watched)data.progress.push({item_id:payload.id,film:payload.film,name:payload.name});}
    if(action==='details')Object.assign(data.items.find(i=>i.id===payload.id),payload.details);
    if(name&&!data.people.includes(name))data.people.push(name);
    persistDemo();render();
  }
  function join() {$('#name').value=name;$('#code').value=code;$('#code-label').hidden=!live;$('#join-error').textContent='';$('#join-dialog').showModal();}
  function requireName() {if(!name){$('#identity').focus();toast('Choose your name at the top first.');return false;}if(live&&!code){join();return false;}return true;}
  function render() {
    $('#identity').value=name;
    const search=$('#search').value.toLowerCase().trim();
    const visible=data.items.filter(item=>{
      const mine=data.votes.find(v=>v.item_id===item.id&&v.name===name)?.interest;
      return (type==='all'||item.type===type)&&[item.title,item.original_title].some(t=>t?.toLowerCase().includes(search))&&(view==='watched'?item.watched:!item.watched)&&(view==='watched'||tonight===null||!data.votes.some(v=>v.item_id===item.id&&tonight.includes(v.name)&&v.interest==='pass'));
    });
    const assessment = item => {
      const votes=data.votes.filter(v=>v.item_id===item.id);
      const absent=tonight===null?[]:votes.filter(v=>v.interest==='hold'&&!tonight.includes(v.name)).map(v=>v.name);
      const score=votes.filter(v=>['interested','hold'].includes(v.interest)&&(tonight===null||tonight.includes(v.name))).length;
      return {votes,absent,score};
    };
    const sort=$('#sort').value;
    visible.sort((a,b)=>sort==='title'?a.title.localeCompare(b.title):['oldest','unanswered'].includes(sort)?addedOrder(a)-addedOrder(b):addedOrder(b)-addedOrder(a));
    if(sort==='unanswered'){
      const responded=new Set(data.votes.filter(v=>v.name===name).map(v=>v.item_id));
      visible.sort((a,b)=>Number(responded.has(a.id))-Number(responded.has(b.id)));
    }
    if(sort==='interest')visible.sort((a,b)=>{const x=assessment(a),y=assessment(b);return Number(!!x.absent.length)-Number(!!y.absent.length)||y.score-x.score;});
    $('#sample-notice').hidden=live||!data.votes.some(v=>v.sample);
    $('#tonight-status').hidden=tonight===null||view==='watched';
    $('#tonight-status').textContent=tonight?.length?`Showing titles for ${tonight.join(', ')} · ${visible.length} matches`:'Select at least one person to see their picks.';
    $('#empty').textContent=tonight!==null&&view!=='watched'?'No matching picks. Select more people, or clear the selection and apply.':'No titles here. Try another category or search.';

    $('#count').textContent=visible.length;$('#empty').hidden=!!visible.length;
    $('#grid').innerHTML=visible.map((item,index)=>{
      const {votes,absent}=assessment(item), mine=votes.find(v=>v.name===name)?.interest;
      const holds=votes.filter(v=>v.interest==='hold').map(v=>v.name), interested=votes.filter(v=>v.interest==='interested').map(v=>v.name), passes=votes.filter(v=>v.interest==='pass').map(v=>v.name);
      const poster=typeof item.poster_path==='string'&&/^\/[\w.-]+$/.test(item.poster_path)?`https://image.tmdb.org/t/p/w500${item.poster_path}`:'';
      const imdb=/^tt\d+$/.test(item.imdb_id||'')?`<a href="https://www.imdb.com/title/${item.imdb_id}/" target="_blank" rel="noopener">IMDb ↗</a>`:'';
      const tmdb=Number.isInteger(Number(item.tmdb_id))&&Number(item.tmdb_id)>0?`<a href="https://www.themoviedb.org/${item.type==='series'?'collection':item.type==='tv'?'tv':'movie'}/${Number(item.tmdb_id)}" target="_blank" rel="noopener">TMDB ↗</a>`:'';
      return `<article class="card" data-id="${escape(item.id)}"><div class="poster ${poster?'':'fallback'}" style="--poster-color:${['#ba02ee','#4502ee','#ee02ab','#ba02ee','#4502ee'][index%5]}">${poster?`<img src="${poster}" alt="${escape(item.title)} poster" loading="lazy">`:`<span aria-hidden="true">${escape(item.title.slice(0,1).toUpperCase())}</span>`}</div><div class="card-body"><h3><button class="title-link" data-open>${escape(displayTitle(item))}</button></h3><div class="meta"><span class="type-label">${types[item.type]||'FILM'}</span>${item.year?`<span>${escape(item.year)}</span>`:''}${item.watched?'<span>Watched ✓</span>':''}<span class="added-date">${dateLabel(item)}</span></div>${item.overview?`<p class="description">${escape(item.overview)}</p>`:''}${absent.length?`<div class="warning">Save this for ${escape(absent.join(', '))} — they’re not here tonight.</div>`:''}<div class="vote-controls response-panel" role="group" aria-label="Responses to ${escape(item.title)}"><div class="people-responses">${names.map(person=>votes.find(v=>v.name===person)||{name:person,interest:'unanswered'}).map(v=>`<span class="person-response response-${v.interest}" tabindex="0" role="img" aria-label="${escape(v.name)}: ${voteLabels[v.interest]||'Not answered'}${v.sample?' (sample)':''}" data-label="${escape(v.name)}: ${voteLabels[v.interest]||'Not answered'}${v.sample?' (sample)':''}">${escape(({Alex:'Al',Ashe:'As',Amanda:'Am'})[v.name]||v.name.slice(0,1))}</span>`).join('')||'<span class="no-response">No responses yet</span>'}</div>${mine&&editingVote!==item.id?`<div class="saved-response response-${mine}"><button class="edit-response" aria-label="Edit your response" title="Edit your response" data-edit-vote ${view==='watched'?'disabled':''}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 3 5 5M4 15 16 3a2 2 0 0 1 5 5L9 20l-6 1z"/></svg></button></div>`:`<div class="response-buttons">${Object.entries(voteLabels).map(([value,label])=>`<button data-vote="${value}" aria-pressed="${mine===value}" ${view==='watched'?'disabled':''}>${label}</button>`).join('')}</div>`}</div><div class="series-summary">${films(item).length?`${films(item).length} films · ${completed(item,'Group')} watched by group`: ''}</div></div></article>`;
    }).join('');
    $('#attendees').innerHTML=names.length?names.map(n=>`<label class="check-label"><input type="checkbox" value="${escape(n)}" ${draftTonight.includes(n)?'checked':''}>${escape(n)}</label>`).join(''):'<p>Your friends appear here once they join and vote.</p>';
    $('#tonight-button').textContent=tonight===null?'Who’s here tonight?':`Tonight: ${tonight.length} joining`;
  }
  function openAdd(item=null) {
    if(!requireName())return;
    editing=item;results=[];$('#results').replaceChildren();$('#lookup').value=item?.lookup_title||item?.title||'';$('#add-type').value=item?.type||'movie';$('#add-type').disabled=!!item;if(!live)$('#quick-form').prepend($('#add-type'));
    $('#quick-form').hidden=!!item;$('#quick-titles').value='';$('#add-heading').textContent=item?'Find the right match':'Add a title';$('#lookup-status').textContent='';$('#add-error').textContent='';$('#add-dialog').showModal();
  }
  async function metadata(payload) {
    if(!live)throw new Error('Poster lookup becomes available after connecting Supabase and a TMDB key. Quick add works in this preview.');
    const response=await fetch(config.supabaseUrl.replace(/\/$/,'')+'/functions/v1/metadata',{method:'POST',headers:{'Content-Type':'application/json',apikey:config.supabasePublishableKey},body:JSON.stringify({...payload,code}),signal:AbortSignal.timeout(15000)});
    const body=await response.json();if(!response.ok)throw new Error(body.error||'Title lookup is unavailable. You can still quick add.');return body;
  }
  $('#join-form').addEventListener('submit',async event=>{
    event.preventDefault();const button=event.submitter||$('#join-form button[type="submit"]');button.disabled=true;$('#join-error').textContent='';
    const oldCode=code;code=$('#code').value.trim();
    try{if(live)data=await rpc('list');name=$('#name').value.trim().replace(/\s+/g,' ');if(!name)throw new Error('Please enter a name.');localStorage.setItem('friday-name',JSON.stringify(name));sessionStorage.setItem('friday-code',JSON.stringify(code));if(!data.people.includes(name))data.people.push(name);$('#join-dialog').close();render();}
    catch(error){code=oldCode;$('#join-error').textContent=error.message;}finally{button.disabled=false;}
  });
  $('#leave').onclick=()=>{localStorage.removeItem('friday-name');sessionStorage.removeItem('friday-code');name='';code='';if(live)data={items:[],votes:[],people:[]};$('#join-dialog').close();render();};
  $('#identity').onchange=()=>{
    editingVote=null;
    const selected=$('#identity').value;
    if(live&&!code){$('#name').value=selected;$('#code-label').hidden=false;$('#join-error').textContent='';$('#join-dialog').showModal();return;}
    name=selected;localStorage.setItem('friday-name',JSON.stringify(name));
    if(name&&!data.people.includes(name))data.people.push(name);
    render();
  };
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
  document.querySelectorAll('[data-type]').forEach(b=>b.onclick=()=>{type=b.dataset.type;document.querySelectorAll('[data-type]').forEach(x=>x.setAttribute('aria-pressed',x===b));render();});
  $('#search').addEventListener('input',render);
  $('#sort').addEventListener('change',()=>{
    try{localStorage.setItem('friday-sort',JSON.stringify($('#sort').value));}catch{}
    render();
  });
  $('#help-button').onclick=()=>$('#help-dialog').showModal();
  $('#add-button').onclick=()=>openAdd();
  $('#tonight-button').onclick=()=>{const panel=$('#tonight-panel');panel.hidden=!panel.hidden;if(!panel.hidden)draftTonight=[...(tonight||[])];$('#tonight-button').setAttribute('aria-expanded',String(!panel.hidden));render();};
  $('#attendees').onchange=()=>{draftTonight=Array.from($('#attendees').querySelectorAll('input:checked')).map(x=>x.value);render();};
  $('#remove-samples').onclick=()=>{data.votes=data.votes.filter(v=>!v.sample);persistDemo();render();};
  $('#attendees-all').onclick=()=>{draftTonight=[...names];render();};
  $('#attendees-none').onclick=()=>{draftTonight=[];render();};
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;document.querySelectorAll('[data-view]').forEach(x=>x.setAttribute('aria-pressed',x===b));render();});
  $('#tonight-apply').onclick=()=>{tonight=draftTonight.length?[...draftTonight]:null;$('#tonight-panel').hidden=true;$('#tonight-button').setAttribute('aria-expanded','false');render();$('#tonight-button').focus();};
  $('#refresh').onclick=async()=>{try{if(live&&!code){join();return;}await load();toast('List refreshed.');}catch(e){toast(e.message);}};
  $('#grid').onclick=async event=>{
    const button=event.target.closest('button');if(!button)return;
    const item=data.items.find(i=>i.id===button.closest('[data-id]').dataset.id);
    if(button.hasAttribute('data-open')){openDetail(item);return;}
    if(!requireName())return;
    if(button.hasAttribute('data-edit-vote')){editingVote=item.id;render();document.querySelector(`[data-id="${item.id}"] [data-vote]`)?.focus();return;}
    button.disabled=true;
    try{if(button.dataset.vote){const current=data.votes.find(v=>v.item_id===item.id&&v.name===name)?.interest;editingVote=null;await mutate('vote',{id:item.id,name,interest:current===button.dataset.vote?null:button.dataset.vote});}
    else if(button.hasAttribute('data-watched'))await mutate('watched',{id:item.id,watched:!item.watched});}
    catch(error){toast(error.message);}finally{button.disabled=false;}
  };
  $('#quick-form').onsubmit=async event=>{
    event.preventDefault();const button=event.submitter||$('#quick-submit');const titles=[...new Set($('#quick-titles').value.split(/\r?\n/).map(t=>t.trim()).filter(Boolean))];
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
      button.textContent='Adding…';await mutate('add',{items});$('#add-dialog').close();
      toast(!live?'Added to the list. Existing titles were skipped.':lookupFailed?'Titles added. Lookup is unavailable; details can be matched later.':`${matched} of ${items.length} titles matched. Added to the list; existing titles were skipped.`);
    }catch(e){$('#add-error').textContent=e.message;}finally{button.disabled=false;button.textContent=label;quickAdding=false;}
  };
  $('#lookup-form').onsubmit=async event=>{
    event.preventDefault();const button=event.submitter||$('#lookup-form button[type="submit"]');button.disabled=true;$('#lookup-status').textContent='Looking for matches…';$('#results').replaceChildren();
    try{results=await metadata({action:'search',query:$('#lookup').value,type:$('#add-type').value});$('#lookup-status').textContent=results.length?'Choose a match. Your original title and notes will be kept.':'No matches. Try another title, or quick add it below.';
    $('#results').innerHTML=results.map((r,i)=>`<button class="result" data-result="${i}"><span><strong>${escape(r.title)}</strong><small>${escape(r.year||'')} · ${escape(r.overview?.slice(0,140)||'No description available')}</small></span></button>`).join('');}
    catch(e){$('#lookup-status').textContent=e.message;}finally{button.disabled=false;}
  };
  $('#results').onclick=async event=>{
    const button=event.target.closest('[data-result]');if(!button)return;button.disabled=true;
    try{const result=results[Number(button.dataset.result)],details=await metadata({action:'details',id:result.tmdb_id,type:$('#add-type').value});
    if(editing)await mutate('details',{id:editing.id,details});else await mutate('add',{items:[{...details,title:result.title,type:$('#add-type').value}]});$('#add-dialog').close();toast(editing?'Details updated.':'Added to the list.');}
    catch(e){$('#add-error').textContent=e.message;}finally{button.disabled=false;}
  };

  function addedOrder(item){return Date.parse(item.created_at)||window.WATCH_SEED.findIndex(i=>i.id===item.id)+1;}
  function dateLabel(item){return item.created_at?'Added '+new Date(item.created_at).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):(window.WATCH_SEED.some(i=>i.id===item.id)?'Original list · #'+(window.WATCH_SEED.findIndex(i=>i.id===item.id)+1):'Added before date tracking');}
  function displayTitle(item){return item.title==='The Princess Diaries 2: Royal Engagement'?'The Princess Diaries':item.title==='Glass Onion: A Knives Out Mystery'?'Knives Out':item.title;}
  function films(item){return window.WATCH_SERIES[item.title]||item.films||[];}
  function filmKey(f){return f[0]+' ('+f[1]+')';}
  function done(item,f,person){return (data.progress||[]).some(p=>p.item_id===item.id&&p.film===filmKey(f)&&p.name===person);}
  function completed(item,person){return films(item).filter(f=>done(item,f,person)).length;}
  function openDetail(item){detailId=item.id;renderDetail();if(!$('#detail-dialog').open)$('#detail-dialog').showModal();}
  function renderDetail(){
    const item=data.items.find(i=>i.id===detailId);if(!item)return;
    const list=films(item);
    $('#detail-content').innerHTML='<p class="eyebrow">'+types[item.type]+'</p><h2>'+escape(displayTitle(item))+'</h2><p class="detail-meta">'+dateLabel(item)+'</p>'+
      (item.overview?'<p>'+escape(item.overview)+'</p>':'')+
      (live&&!item.tmdb_id?'<p><button class="secondary" data-match>Find a match</button></p>':'')+
      (item.imdb_id?'<a href="https://www.imdb.com/title/'+escape(item.imdb_id)+'/" target="_blank" rel="noopener">View on IMDb ↗</a>':'')+
      (list.length?'<h3>Series progress</h3><p class="hint">Release order'+(item.title==='The Muppets'?' · Theatrical films':'')+'. Group and personal progress are tracked separately.</p><div class="progress-heading"><span>Film</span><span>Group</span><span>'+escape(name||'You')+'</span></div>'+list.map((f,index)=>'<div class="film-row"><span><b>'+escape(f[0])+'</b><small>'+f[1]+'</small></span>'+['Group',name].map(person=>'<label><span class="sr-only">'+escape(f[0])+' watched by '+escape(person||'you')+'</span><input type="checkbox" data-film="'+index+'" data-person="'+escape(person)+'" '+(done(item,f,person)?'checked':'')+' '+(!name?'disabled':'')+'></label>').join('')+'</div>').join(''):'')+
      '<div class="history-actions"><h3>Group watch history</h3><p class="hint">Move this '+(list.length?'series':'title')+' between the watch list and Watched.</p><button class="secondary" data-archive>'+ (item.watched?'Move back to watch list':'Move to Watched')+'</button></div>'+
      (item.tmdb_id?'<p class="hint">Metadata from <a href="https://www.themoviedb.org/" target="_blank" rel="noopener">TMDB</a>. This product uses the TMDB API but is not endorsed or certified by TMDB.</p>':'');
  }
  $('#detail-content').onchange=async event=>{
    const input=event.target.closest('[data-film]');if(!input||!requireName())return;
    const item=data.items.find(i=>i.id===detailId);input.disabled=true;
    try{await mutate('progress',{id:item.id,film:filmKey(films(item)[Number(input.dataset.film)]),name:input.dataset.person,watched:input.checked});renderDetail();}catch(e){input.checked=!input.checked;toast(e.message);}finally{input.disabled=false;}
  };
  $('#detail-content').onclick=async event=>{
    if(event.target.closest('[data-match]')){if(!requireName())return;const item=data.items.find(i=>i.id===detailId);$('#detail-dialog').close();openAdd(item);return;}
    const button=event.target.closest('[data-archive]');if(!button||!requireName())return;
    const item=data.items.find(i=>i.id===detailId);button.disabled=true;
    try{await mutate('watched',{id:item.id,watched:!item.watched});$('#detail-dialog').close();}catch(e){toast(e.message);}finally{button.disabled=false;}
  };
  async function autoDetails(){
    if(!live||!code||autoRunning||quickAdding)return;autoRunning=true;
    try{for(const item of data.items){
      if(item.tmdb_id||attempted.has(item.id)||item.match_status==='needs_confirmation')continue;
      attempted.add(item.id);
      try{const details=await metadata({action:'resolve',type:item.type,imdb_id:item.imdb_id,title:item.lookup_title||displayTitle(item),year:item.year});
        if(details){await rpc('details',{id:item.id,details});Object.assign(item,details);}
      }catch{attempted.delete(item.id);break;}
    }if(!document.querySelector('dialog[open]'))render();}finally{autoRunning=false;}
  }

  $('#lookup-form').hidden=!live;
  load().catch(e=>{toast(e.message);join();});
  if(live&&!code)join();
  // Refresh between interactions; never repaint an open form or an active write.
  setInterval(async()=>{if(!live||!code||document.hidden||document.querySelector('dialog[open]')||syncing||document.activeElement?.closest('.card'))return;syncing=true;try{await load();}catch{}finally{syncing=false;}},30000);
})();
