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
