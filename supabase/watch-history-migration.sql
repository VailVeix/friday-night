-- Run in Supabase SQL Editor AFTER admin-migration.sql and personal-seen-migration.sql.
-- Safe to rerun. Existing watch flags, votes, progress, and personal history stay intact.
-- Old watches keep NULL metadata: their dates and attendees cannot be reconstructed.
begin;

alter table watch_private.items
  add column if not exists watched_at timestamptz,
  add column if not exists watched_on date,
  add column if not exists watched_attendees text[],
  add column if not exists watched_by text;
alter table watch_private.progress
  add column if not exists watched_at timestamptz,
  add column if not exists watched_on date,
  add column if not exists watched_attendees text[],
  add column if not exists watched_by text;

-- Called only through the existing code-gated API, never directly by browsers.
create or replace function watch_private.watch_context(p_payload jsonb)
returns table(watched_at timestamptz, watched_on date, watched_attendees text[], watched_by text)
language plpgsql set search_path = '' as $$
declare
  v_stamp timestamptz := clock_timestamp();
  v_zone text := coalesce(p_payload->>'time_zone','UTC');
  v_attendees text[];
  v_by text := p_payload->>'recorded_by';
begin
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=v_zone) then
    raise exception 'Invalid watch time zone';
  end if;
  if p_payload ? 'recorded_by' and p_payload->'recorded_by' <> 'null'::jsonb then
    if jsonb_typeof(p_payload->'recorded_by') <> 'string'
      or not exists(select 1 from watch_private.people where name=v_by) then
      raise exception 'Invalid recorded-by name';
    end if;
  end if;
  if p_payload ? 'attendees' and p_payload->'attendees' <> 'null'::jsonb then
    if jsonb_typeof(p_payload->'attendees') <> 'array' then raise exception 'Attendees must be an array'; end if;
    if jsonb_array_length(p_payload->'attendees') > 100 then raise exception 'Too many attendees'; end if;
    if exists(select 1 from jsonb_array_elements(p_payload->'attendees') a(value)
      where jsonb_typeof(a.value) <> 'string'
        or not exists(select 1 from watch_private.people p where p.name=a.value #>> '{}')) then
      raise exception 'Invalid attendee name';
    end if;
    select array_agg(a.name order by a.position) into v_attendees from (
      select value as name,min(ordinality) as position
      from jsonb_array_elements_text(p_payload->'attendees') with ordinality
      group by value
    ) a;
  end if;
  return query select v_stamp,(v_stamp at time zone v_zone)::date,v_attendees,v_by;
end;
$$;

create or replace function watch_private.set_watch_status(p_id uuid,p_payload jsonb)
returns void language plpgsql set search_path = '' as $$
declare
  v_context record;
begin
  if jsonb_typeof(p_payload->'watched') is distinct from 'boolean' then raise exception 'Invalid watched status'; end if;
  if (p_payload->>'watched')::boolean then
    select * into v_context from watch_private.watch_context(p_payload);
    -- Only a new group watch creates personal seen records. Repeated true saves
    -- cannot add people from a changed filter or overwrite existing personal history.
    update watch_private.items set
      watched_at=v_context.watched_at,
      watched_on=v_context.watched_on,
      watched_attendees=v_context.watched_attendees,
      watched_by=v_context.watched_by,
      watched=true
    where id=p_id and not watched;
    if found then
      insert into watch_private.seen(item_id,name,created_at)
      select p_id,person,v_context.watched_at from unnest(v_context.watched_attendees) as person
      on conflict do nothing;
    end if;
  else
    update watch_private.items set watched=false,watched_at=null,watched_on=null,
      watched_attendees=null,watched_by=null where id=p_id;
  end if;
end;
$$;

create or replace function watch_private.set_watch_progress(p_id uuid,p_payload jsonb)
returns void language plpgsql set search_path = '' as $$
declare
  v_context record;
begin
  if jsonb_typeof(p_payload->'watched') is distinct from 'boolean' then raise exception 'Invalid watched status'; end if;
  if (p_payload->>'watched')::boolean then
    if p_payload->>'name'='Group' then
      select * into v_context from watch_private.watch_context(p_payload);
      insert into watch_private.progress(item_id,film,name,watched_at,watched_on,watched_attendees,watched_by)
      values(p_id,p_payload->>'film','Group',v_context.watched_at,v_context.watched_on,v_context.watched_attendees,v_context.watched_by)
      on conflict do nothing;
      if found then
        -- A film/episode watch marks only that film/episode for each attendee,
        -- never an entire series or TV show as personally seen.
        insert into watch_private.progress(item_id,film,name)
        select p_id,p_payload->>'film',person from unnest(v_context.watched_attendees) as person
        on conflict do nothing;
      end if;
    else
      -- Personal checklist progress remains independent of group viewing records.
      insert into watch_private.progress(item_id,film,name)
      values(p_id,p_payload->>'film',p_payload->>'name') on conflict do nothing;
    end if;
  else
    delete from watch_private.progress where item_id=p_id and film=p_payload->>'film' and name=p_payload->>'name';
  end if;
end;
$$;
revoke all on function watch_private.watch_context(jsonb) from public,anon,authenticated;
revoke all on function watch_private.set_watch_status(uuid,jsonb) from public,anon,authenticated;
revoke all on function watch_private.set_watch_progress(uuid,jsonb) from public,anon,authenticated;

-- Preserve the deployed API's authorization, roster, personal history and other actions.
do $migration$
declare
  definition text := pg_get_functiondef('public.watch_api(text,text,jsonb)'::regprocedure);
  old_progress text := $old$if (p_payload->>'watched')::boolean then
      insert into watch_private.progress(item_id,film,name) values(v_id,p_payload->>'film',p_payload->>'name') on conflict do nothing;
    else
      delete from watch_private.progress where item_id=v_id and film=p_payload->>'film' and name=p_payload->>'name';
    end if;$old$;
  old_watched text := $old$update watch_private.items set watched=(p_payload->>'watched')::boolean where id=v_id;$old$;
  old_list text := $old$'items',coalesce$old$;
begin
  definition := replace(definition,chr(13),'');
  old_progress := replace(old_progress,chr(13),'');
  if strpos(definition,'watch_private.set_watch_progress(v_id,p_payload)')=0 then
    if strpos(definition,old_progress)=0 then raise exception 'Unexpected progress action; inspect before migrating'; end if;
    definition := replace(definition,old_progress,'perform watch_private.set_watch_progress(v_id,p_payload);');
  end if;
  if strpos(definition,'watch_private.set_watch_status(v_id,p_payload)')=0 then
    if strpos(definition,old_watched)=0 then raise exception 'Unexpected watched action; inspect before migrating'; end if;
    definition := replace(definition,old_watched,'perform watch_private.set_watch_status(v_id,p_payload);');
  end if;
  if strpos(definition,$marker$'watch_details_version',1$marker$)>0 then
    definition := replace(definition,$old$'watch_details_version',1$old$,$new$'watch_details_version',2$new$);
  end if;
  if strpos(definition,$marker$'watch_details_version',2$marker$)=0 then
    if strpos(definition,old_list)=0 then raise exception 'Unexpected list action; inspect before migrating'; end if;
    definition := replace(definition,old_list,$new$'watch_details_version',2,
      'items',coalesce$new$);
  end if;
  execute definition;
end;
$migration$;
notify pgrst, 'reload schema';
commit;
