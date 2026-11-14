-- Run after schema.sql on both new and existing installations.
-- Set admin_password_hash separately; never commit the real admin password.
alter table watch_private.settings add column if not exists admin_password_hash text;
create table if not exists watch_private.people (
  position bigint generated always as identity primary key,
  name text not null check(length(name) between 1 and 40 and name=btrim(name) and name !~ '[[:cntrl:]]')
);
create unique index if not exists people_name_unique on watch_private.people(lower(name));
alter table watch_private.people enable row level security;
revoke all on watch_private.people from public, anon, authenticated;
insert into watch_private.people(name)
select name from unnest(array['Alex','Lyss','Julie','Blue','Ashe','Amanda','Emi','Wils','Michelle']) with ordinality as defaults(name,ordinality)
order by ordinality on conflict do nothing;
insert into watch_private.people(name)
select distinct name from watch_private.votes order by name on conflict do nothing;

-- Names were already public in the website. This endpoint exposes names only.
create or replace function public.watch_people()
returns jsonb language sql security definer set search_path = '' stable as $$
  select coalesce(jsonb_agg(name order by position),'[]'::jsonb) from watch_private.people;
$$;
revoke all on function public.watch_people() from public;
grant execute on function public.watch_people() to anon, authenticated;

create or replace function public.watch_admin(p_password text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_hash text;
  v_group_hash text;
  v_name text;
  v_password text;
begin
  if p_password is null or octet_length(p_password) not between 12 and 72 then
    raise exception 'Invalid admin password';
  end if;
  select admin_password_hash,code_hash into v_hash,v_group_hash from watch_private.settings where singleton=true;
  if v_hash is null or extensions.crypt(p_password,v_hash) is distinct from v_hash then
    raise exception 'Invalid admin password';
  end if;
  if p_action='list' then return public.watch_people(); end if;
  if p_action='add_person' then
    v_name := btrim(regexp_replace(p_payload->>'name','\s+',' ','g'));
    if v_name is null or length(v_name) not between 1 and 40 or v_name ~ '[[:cntrl:]]' then
      raise exception 'Enter a name between 1 and 40 characters';
    end if;
    if lower(v_name)='group' then raise exception 'Group is reserved for shared watch history'; end if;
    begin
      insert into watch_private.people(name) values(v_name);
    exception when unique_violation then raise exception 'That name is already on the list';
    end;
    return public.watch_people();
  elsif p_action='change_password' then
    v_password := p_payload->>'password';
    if v_password is null or length(v_password)<12 or octet_length(v_password)>72 then
      raise exception 'Use at least 12 characters, up to 72 bytes';
    end if;
    if extensions.crypt(v_password,v_group_hash)=v_group_hash then
      raise exception 'Choose an admin password different from the group code';
    end if;
    update watch_private.settings set admin_password_hash=extensions.crypt(v_password,extensions.gen_salt('bf',12)) where singleton=true;
    return 'true'::jsonb;
  end if;
  raise exception 'Unknown admin action';
end;
$$;
revoke all on function public.watch_admin(text,text,jsonb) from public;
grant execute on function public.watch_admin(text,text,jsonb) to anon, authenticated;

-- Preserve the deployed watch API and its data while switching to the managed roster.
do $migration$
declare
  definition text := pg_get_functiondef('public.watch_api(text,text,jsonb)'::regprocedure);
  old_people text := $old$'people',coalesce((select jsonb_agg(n.name order by n.name) from (select distinct name from watch_private.votes) n),'[]'::jsonb)$old$;
  new_people text := $new$'people',public.watch_people()$new$;
  old_name text := $old$v_name is null or length(v_name) not between 1 and 40$old$;
  new_name text := $new$v_name is null or length(v_name) not between 1 and 40 or not exists(select 1 from watch_private.people where name=v_name)$new$;
begin
  if strpos(definition,new_people)=0 then
    if strpos(definition,old_people)=0 then raise exception 'Unexpected watch API roster; inspect before migrating'; end if;
    definition := replace(definition,old_people,new_people);
  end if;
  if strpos(definition,new_name)=0 then
    if strpos(definition,old_name)=0 then raise exception 'Unexpected watch API name validation'; end if;
    definition := replace(definition,old_name,new_name);
  end if;
  execute definition;
end;
$migration$;

notify pgrst, 'reload schema';

-- Initial setup / host recovery (replace the placeholder privately):
-- update watch_private.settings set admin_password_hash=extensions.crypt('REPLACE-WITH-PRIVATE-ADMIN-PASSWORD',extensions.gen_salt('bf',12)) where singleton=true;
