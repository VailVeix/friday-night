// Regenerate the local seed and Supabase import from the reviewed title matches.
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'catalog.json'),'utf8'));
const items=catalog.map(({number,...item})=>({id:'00000000-0000-4000-8000-'+String(number).padStart(12,'0'),...item,match_status:item.match_status||(item.type==='series'?'franchise':'matched'),source_url:item.source_url||'https://www.imdb.com/title/'+item.imdb_id+'/',watched:false}));
fs.writeFileSync(path.join(root,'seed.js'),'// Generated from catalog.json. Keep stable IDs to preserve existing votes.\nwindow.WATCH_SEED = '+JSON.stringify(items,null,2)+';\n');
const sql=`-- Reviewed title matches. Does not overwrite watched status, votes, posters, or summaries.
-- Also upgrades an existing installation created before title matching was added.
alter table watch_private.items add column if not exists original_title text;
alter table watch_private.items add column if not exists notes text;
alter table watch_private.items add column if not exists match_status text;
insert into watch_private.items(id,title,type,year,imdb_id,original_title,notes,match_status)
select id,title,type,year,imdb_id,original_title,notes,match_status
from jsonb_to_recordset($catalog$${JSON.stringify(items)}$catalog$::jsonb)
as x(id uuid,title text,type text,year text,imdb_id text,original_title text,notes text,match_status text)
on conflict(id) do update set
  title=excluded.title,
  type=excluded.type,
  year=coalesce(excluded.year,watch_private.items.year),
  imdb_id=coalesce(excluded.imdb_id,watch_private.items.imdb_id),
  original_title=excluded.original_title,
  notes=excluded.notes,
  match_status=excluded.match_status;
`;
fs.writeFileSync(path.join(root,'supabase/seed.sql'),sql);
console.log('Generated '+items.length+' reviewed titles; '+items.filter(i=>i.imdb_id).length+' IMDb links.');
