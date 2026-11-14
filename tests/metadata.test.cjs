const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const {stripTypeScriptTypes}=require('node:module');
const source=stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'../supabase/functions/metadata/index.ts'),'utf8'));
function proxy(fetchImpl,secrets={SUPABASE_URL:'https://example.supabase.co',WATCH_PUBLIC_KEY:'public',TMDB_READ_TOKEN:'secret-token'}) {
  let handler;
  vm.runInNewContext(source,{Deno:{env:{get:key=>secrets[key]},serve:fn=>handler=fn},fetch:fetchImpl,Response,Request,AbortSignal,console});
  return payload=>handler(new Request('https://example.supabase.co/functions/v1/metadata',{method:'POST',body:JSON.stringify(payload)}));
}
test('metadata rejects unauthenticated requests before contacting TMDB',async()=>{
  let calls=0;const handle=proxy(async()=>{calls++;return {ok:false};});
  assert.equal((await handle({code:'short',action:'search',query:'Alien',type:'movie'})).status,403);assert.equal(calls,0);
  assert.equal((await handle({code:'wrong-but-long-enough',action:'search',query:'Alien',type:'movie'})).status,403);assert.equal(calls,1);
});

test('TV seasons are ordered with specials last and episodes retain stable numbers',async()=>{
  const calls=[];const handle=proxy(async url=>{
    calls.push(url);
    return {ok:true,json:async()=>url.endsWith('/season/0')?{episodes:[{episode_number:2,name:'Bonus',air_date:null},{episode_number:1,name:'Pilot',air_date:'2020-01-01'}]}:url.endsWith('/tv/42')?{seasons:[{season_number:0,name:'Specials',episode_count:2},{season_number:2,name:'Season 2',episode_count:10},{season_number:1,name:'Season 1',episode_count:8}]}:true};
  });
  const seasons=await(await handle({code:'test-code',action:'seasons',type:'tv',id:42})).json();
  assert.deepEqual(seasons.map(s=>s.number),[1,2,0]);assert.equal(seasons[0].episode_count,8);
  const episodes=await(await handle({code:'test-code',action:'episodes',type:'tv',id:42,season:0})).json();
  assert.deepEqual(episodes,[{number:1,name:'Pilot',air_date:'2020-01-01'},{number:2,name:'Bonus',air_date:null}]);
  assert.ok(calls.some(url=>url.endsWith('/tv/42/season/0')));
});

test('TV tracker validates IDs and seasons before lookup and keeps group-code protection',async()=>{
  let lookups=0;const handle=proxy(async url=>{if(url.includes('themoviedb'))lookups++;return {ok:true,json:async()=>({})};});
  for(const payload of [{action:'seasons',type:'movie',id:42},{action:'seasons',type:'tv',id:'42'},{action:'episodes',type:'tv',id:42,season:-1},{action:'episodes',type:'tv',id:42,season:'1/credits'},{action:'episodes',type:'tv',id:42,season:1.5}]){
    assert.equal((await handle({code:'test-code',...payload})).status,400);
  }
  assert.equal(lookups,0);
  const denied=proxy(async()=>({ok:false}));
  assert.equal((await denied({code:'test-code',action:'episodes',type:'tv',id:42,season:1})).status,403);
});
test('series search uses collections and keeps the token server-side',async()=>{
  const calls=[];const handle=proxy(async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>url.includes('/search/')?{results:[{id:8091,name:'Alien Collection',overview:'Space horror.'}]}:true};});
  const response=await handle({code:'test-code',action:'search',query:'Alien & more',type:'series'});
  const results=await response.json();assert.equal(results[0].tmdb_id,8091);assert.equal(results[0].title,'Alien Collection');assert.ok(calls[1].url.includes('/search/collection?'));assert.ok(calls[1].url.includes('Alien%20%26%20more'));assert.equal(calls[1].options.headers.Authorization,'Bearer secret-token');assert.ok(!JSON.stringify(results).includes('secret-token'));
});
test('TV details include IMDb external IDs',async()=>{
  const calls=[];const handle=proxy(async url=>{calls.push(url);return {ok:true,json:async()=>url.includes('api.themoviedb')?{id:42,poster_path:'/poster.jpg',name:'A show',first_air_date:'2020-01-01',external_ids:{imdb_id:'tt1234567'}}:true};});
  const response=await handle({code:'correct-and-long-enough',action:'details',id:42,type:'tv'});const body=await response.json();assert.equal(body.imdb_id,'tt1234567');assert.equal(body.year,'2020');assert.ok(calls[1].endsWith('/tv/42?append_to_response=external_ids'));
});
test('unknown kinds and invalid IDs never reach TMDB',async()=>{
  let calls=0;const handle=proxy(async()=>{calls++;return {ok:true};});
  assert.equal((await handle({code:'correct-and-long-enough',action:'search',type:'../../settings',query:'Alien'})).status,400);
  assert.equal((await handle({code:'correct-and-long-enough',action:'details',type:'movie',id:'1?evil'})).status,400);assert.equal(calls,2);
});
test('missing TMDB setup returns a useful message while preserving quick-add independence',async()=>{
  const handle=proxy(async()=>({ok:true}),{SUPABASE_URL:'https://example.supabase.co',WATCH_PUBLIC_KEY:'public'});
  const response=await handle({code:'correct-and-long-enough',action:'search',type:'movie',query:'Alien'});assert.equal(response.status,503);assert.match((await response.json()).error,/Quick add/);
});
test('missing IMDb mapping falls back to a unique exact title and year',async()=>{
  const calls=[];const handle=proxy(async url=>{
    calls.push(url);
    const body=url.includes('/find/')?{tv_results:[]}:url.includes('/search/')?{results:[{id:123,name:'A test series',first_air_date:'2022-01-01'},{id:456,name:'A test series',first_air_date:'1990-01-01'}]}:url.includes('/tv/123')?{id:123,name:'A test series',first_air_date:'2022-01-01',poster_path:'/test.jpg'}:true;
    return {ok:true,json:async()=>body};
  });
  const response=await handle({code:'test-code',action:'resolve',type:'tv',imdb_id:'tt1234567',title:'A test series',year:'2022'});
  assert.equal(response.status,200);assert.equal((await response.json()).tmdb_id,123);
  assert.ok(calls.some(url=>url.includes('/find/tt1234567')));assert.ok(calls.some(url=>url.includes('/search/tv')));
});
test('line-by-line titles can use a parenthesized year and rewatch note',async()=>{
  const calls=[];const handle=proxy(async url=>{calls.push(url);return {ok:true,json:async()=>url.includes('/search/')?{results:[{id:12,title:'Example',release_date:'1996-01-01'},{id:34,title:'Example',release_date:'2025-01-01'}]}:url.includes('/movie/')?{id:12,poster_path:'/example.jpg'}:true};});
  const result=await handle({code:'test-code',action:'resolve',type:'movie',title:'Example (1996) (rewatch)'});
  assert.equal((await result.json()).tmdb_id,12);assert.ok(calls.some(url=>url.endsWith('query=Example')));
  const ambiguous=await handle({code:'test-code',action:'resolve',type:'movie',title:'Example'});assert.equal(await ambiguous.json(),null);
});
