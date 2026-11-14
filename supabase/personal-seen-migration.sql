-- Run after schema.sql and admin-migration.sql. Personal history is independent
-- of interest votes, series checklists, and the group's Watched archive.
create table if not exists watch_private.seen (
  item_id uuid not null references watch_private.items(id) on delete cascade,
  name text not null check(length(name) between 1 and 40),
  created_at timestamptz not null default now(),
  primary key(item_id,name)
);
alter table watch_private.seen enable row level security;
revoke all on watch_private.seen from public, anon, authenticated;

do $migration$
declare
  definition text := pg_get_functiondef('public.watch_api(text,text,jsonb)'::regprocedure);
  old_list text := $old$'progress',coalesce$old$;
  new_list text := $new$'seen',coalesce((select jsonb_agg(to_jsonb(s) order by s.item_id,s.name) from watch_private.seen s),'[]'::jsonb),
      'progress',coalesce$new$;
  old_action text := $old$if p_action='vote' then$old$;
  new_action text := $new$if p_action='seen' then
    v_name := btrim(regexp_replace(p_payload->>'name','\s+',' ','g'));
    if v_name is null or not exists(select 1 from watch_private.people where name=v_name) then raise exception 'Invalid name'; end if;
    if jsonb_typeof(p_payload->'seen') is distinct from 'boolean' then raise exception 'Invalid seen status'; end if;
    if (p_payload->>'seen')::boolean then
      insert into watch_private.seen(item_id,name) values(v_id,v_name) on conflict do nothing;
    else
      delete from watch_private.seen where item_id=v_id and name=v_name;
    end if;
  elsif p_action='vote' then$new$;
begin
  if strpos(definition,$marker$'seen',coalesce$marker$)=0 then
    if strpos(definition,old_list)=0 then raise exception 'Unexpected watch API list; inspect before migrating'; end if;
    definition := replace(definition,old_list,new_list);
  end if;
  if strpos(definition,$marker$if p_action='seen' then$marker$)=0 then
    if strpos(definition,old_action)=0 then raise exception 'Unexpected watch API actions; inspect before migrating'; end if;
    definition := replace(definition,old_action,new_action);
  end if;
  execute definition;
end;
$migration$;
notify pgrst, 'reload schema';
