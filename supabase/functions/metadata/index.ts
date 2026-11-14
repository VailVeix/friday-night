// Deploy as "metadata" with JWT verification OFF. The group code is verified
// by watch_api before every TMDB request. No npm imports or service key needed.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
const kind = {movie:'movie',tv:'tv',series:'collection'};
Deno.serve(async request => {
  if(request.method==='OPTIONS')return new Response(null,{headers:cors});
  if(request.method!=='POST')return json({error:'Use POST.'},405);
  try {
    const raw=await request.text();if(raw.length>4096)return json({error:'Request too large.'},413);
    const input=JSON.parse(raw);
    if(typeof input.code!=='string'||input.code.length<16||input.code.length>100)return json({error:'Group code required.'},403);
    const url=Deno.env.get('SUPABASE_URL');
    const publicKey=Deno.env.get('WATCH_PUBLIC_KEY');
    const token=Deno.env.get('TMDB_READ_TOKEN');
    if(!url||!publicKey)return json({error:'The host needs to finish the metadata function settings.'},503);
    const auth=await fetch(url+'/rest/v1/rpc/watch_api',{method:'POST',headers:{'Content-Type':'application/json',apikey:publicKey},body:JSON.stringify({p_code:input.code,p_action:'authorize'}),signal:AbortSignal.timeout(10000)});
    if(!auth.ok)return json({error:'That group code didn’t work.'},403);
    if(!token)return json({error:'Poster lookup isn’t connected yet. Quick add still works.'},503);
    const resource=Object.hasOwn(kind,input.type)?kind[input.type as keyof typeof kind]:null;
    if(!resource)return json({error:'Invalid title type.'},400);
    async function tmdb(path:string) {
      const response=await fetch('https://api.themoviedb.org/3'+path,{headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw new Error('TMDB is unavailable. Try again later or use quick add.');
      return response.json();
    }
    if(input.action==='resolve') {
      let id;
      if(typeof input.imdb_id==='string' && /^tt\d+$/.test(input.imdb_id) && resource!=='collection') {
        const found=await tmdb('/find/'+input.imdb_id+'?external_source=imdb_id');
        id=(resource==='tv'?found.tv_results:found.movie_results)?.[0]?.id;
      }else if(typeof input.title==='string' && input.title.length<=200){
        const found=await tmdb('/search/'+resource+'?include_adult=false&query='+encodeURIComponent(input.title));
        const normalize=(v:string)=>v.toLowerCase().replace(/[^a-z0-9]/g,'').replace(/collection$/,'');
        const exact=found.results.filter((r:any)=>normalize(r.title||r.name)===normalize(input.title)&&(!input.year||String(r.release_date||r.first_air_date||'').startsWith(input.year)));
        if(exact.length===1)id=exact[0].id;
      }
      if(!id)return json(null);
      const details=await tmdb('/'+resource+'/'+id+(resource==='collection'?'':'?append_to_response=external_ids'));
      return json({tmdb_id:details.id,poster_path:details.poster_path||null,overview:details.overview||'',year:String(details.release_date||details.first_air_date||'').slice(0,4),imdb_id:details.imdb_id||details.external_ids?.imdb_id||null,films:resource==='collection'?(details.parts||[]).filter((p:any)=>p.release_date&&p.release_date<=new Date().toISOString().slice(0,10)).sort((a:any,b:any)=>a.release_date.localeCompare(b.release_date)).map((p:any)=>[p.title,Number(p.release_date.slice(0,4))]):null});
    }
    if(input.action==='search') {
      if(typeof input.query!=='string'||!input.query.trim()||input.query.length>200)return json({error:'Enter a title under 200 characters.'},400);
      const response=await tmdb('/search/'+resource+'?include_adult=false&query='+encodeURIComponent(input.query.trim()));
      return json(response.results.slice(0,8).map((r:Record<string,unknown>)=>({tmdb_id:r.id,title:r.title||r.name,year:String(r.release_date||r.first_air_date||'').slice(0,4),overview:r.overview||''})));
    }
    if(input.action==='details') {
      if(!Number.isSafeInteger(input.id)||input.id<=0)return json({error:'Invalid title ID.'},400);
      const details=await tmdb('/'+resource+'/'+input.id+(resource==='collection'?'':'?append_to_response=external_ids'));
      return json({tmdb_id:details.id,poster_path:details.poster_path||null,overview:details.overview||'',year:String(details.release_date||details.first_air_date||'').slice(0,4),imdb_id:details.imdb_id||details.external_ids?.imdb_id||null,films:resource==='collection'?(details.parts||[]).filter((p:any)=>p.release_date&&p.release_date<=new Date().toISOString().slice(0,10)).sort((a:any,b:any)=>a.release_date.localeCompare(b.release_date)).map((p:any)=>[p.title,Number(p.release_date.slice(0,4))]):null});
    }
    return json({error:'Unknown action.'},400);
  }catch(error) {
    return json({error:error instanceof SyntaxError?'Invalid request.':error instanceof Error&&error.message.startsWith('TMDB')?error.message:'Lookup failed. Please try again, or use quick add.'},502);
  }
});
