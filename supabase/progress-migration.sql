alter table watch_private.items add column if not exists films jsonb;
create table if not exists watch_private.progress (
  item_id uuid not null references watch_private.items(id) on delete cascade,
  film text not null check(length(film) between 1 and 300),
  name text not null check(length(name) between 1 and 40),
  primary key(item_id,film,name)
);
alter table watch_private.progress enable row level security;
revoke all on watch_private.progress from public, anon, authenticated;

create or replace function public.watch_api(p_code text, p_action text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_hash text;
  v_item jsonb;
  v_details jsonb;
  v_name text;
  v_id uuid;
begin
  if p_code is null or length(p_code) < 16 or length(p_code) > 100 then
    raise exception 'Invalid group code';
  end if;
  select code_hash into v_hash from watch_private.settings where singleton=true;
  if v_hash is null or extensions.crypt(p_code,v_hash) is distinct from v_hash then
    raise exception 'Invalid group code';
  end if;
  if p_action='authorize' then return 'true'::jsonb; end if;
  if p_action='list' then
    return jsonb_build_object(
      'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at,i.id) from watch_private.items i),'[]'::jsonb),
      'progress',coalesce((select jsonb_agg(to_jsonb(p)) from watch_private.progress p),'[]'::jsonb),
      'votes',coalesce((select jsonb_agg(to_jsonb(v) order by v.name) from watch_private.votes v),'[]'::jsonb),
      'people',coalesce((select jsonb_agg(n.name order by n.name) from (select distinct name from watch_private.votes) n),'[]'::jsonb)
    );
  end if;
  if p_action='add' then
    if jsonb_typeof(p_payload->'items') is distinct from 'array' then raise exception 'Items must be an array'; end if;
    if jsonb_array_length(p_payload->'items') not between 1 and 100 then raise exception 'Add 1–100 titles'; end if;
    for v_item in select value from jsonb_array_elements(p_payload->'items') loop
      if nullif(trim(v_item->>'title'),'') is null or length(trim(v_item->>'title'))>200 then raise exception 'Invalid title'; end if;
      if coalesce(v_item->>'type','') not in ('movie','series','tv') then raise exception 'Invalid title type'; end if;
      if length(coalesce(v_item->>'overview',''))>10000 or length(coalesce(v_item->>'poster_path',''))>200 then raise exception 'Details too long'; end if;
      if nullif(v_item->>'poster_path','') is not null and (v_item->>'poster_path') !~ '^/[A-Za-z0-9_.-]+$' then raise exception 'Invalid poster'; end if;
      if nullif(v_item->>'imdb_id','') is not null and (v_item->>'imdb_id') !~ '^tt[0-9]+$' then raise exception 'Invalid IMDb ID'; end if;
      if length(coalesce(v_item->>'year',''))>4 then raise exception 'Invalid year'; end if;
      if exists(select 1 from watch_private.items where type=v_item->>'type' and (lower(title)=lower(trim(v_item->>'title')) or lower(original_title)=lower(trim(v_item->>'title')))) then continue; end if;
      insert into watch_private.items(title,type,tmdb_id,poster_path,overview,year,imdb_id,films)
      values(trim(v_item->>'title'),v_item->>'type',nullif(v_item->>'tmdb_id','')::bigint,nullif(v_item->>'poster_path',''),v_item->>'overview',v_item->>'year',nullif(v_item->>'imdb_id',''),v_item->'films')
      on conflict do nothing;
    end loop;
    return 'true'::jsonb;
  end if;
  v_id := (p_payload->>'id')::uuid;
  if not exists(select 1 from watch_private.items where id=v_id) then raise exception 'Title not found'; end if;
  if p_action='vote' then
    v_name := regexp_replace(trim(p_payload->>'name'),'\s+',' ','g');
    if v_name is null or length(v_name) not between 1 and 40 then raise exception 'Invalid name'; end if;
    if p_payload->>'interest' is null then
      delete from watch_private.votes where item_id=v_id and name=v_name;
    else
      insert into watch_private.votes(item_id,name,interest) values(v_id,v_name,p_payload->>'interest')
      on conflict(item_id,name) do update set interest=excluded.interest;
    end if;
  elsif p_action='progress' then
    if jsonb_typeof(p_payload->'watched') is distinct from 'boolean' then raise exception 'Invalid watched status'; end if;
    if (p_payload->>'watched')::boolean then
      insert into watch_private.progress(item_id,film,name) values(v_id,p_payload->>'film',p_payload->>'name') on conflict do nothing;
    else
      delete from watch_private.progress where item_id=v_id and film=p_payload->>'film' and name=p_payload->>'name';
    end if;
  elsif p_action='watched' then
    if jsonb_typeof(p_payload->'watched') is distinct from 'boolean' then raise exception 'Invalid watched status'; end if;
    update watch_private.items set watched=(p_payload->>'watched')::boolean where id=v_id;
  elsif p_action='details' then
    v_details := p_payload->'details';
    if jsonb_typeof(v_details) is distinct from 'object' then raise exception 'Invalid details'; end if;
    if length(coalesce(v_details->>'overview',''))>10000 or length(coalesce(v_details->>'poster_path',''))>200 then raise exception 'Details too long'; end if;
    if nullif(v_details->>'poster_path','') is not null and (v_details->>'poster_path') !~ '^/[A-Za-z0-9_.-]+$' then raise exception 'Invalid poster'; end if;
    if nullif(v_details->>'imdb_id','') is not null and (v_details->>'imdb_id') !~ '^tt[0-9]+$' then raise exception 'Invalid IMDb ID'; end if;
    if length(coalesce(v_details->>'year',''))>4 then raise exception 'Invalid year'; end if;
    update watch_private.items set films=coalesce(v_details->'films',films),tmdb_id=nullif(v_details->>'tmdb_id','')::bigint,poster_path=nullif(v_details->>'poster_path',''),overview=v_details->>'overview',year=v_details->>'year',imdb_id=nullif(v_details->>'imdb_id','') where id=v_id;
  else raise exception 'Unknown action';
  end if;
  return 'true'::jsonb;
end;
$$;
revoke all on function public.watch_api(text,text,jsonb) from public;
grant execute on function public.watch_api(text,text,jsonb) to anon, authenticated;
