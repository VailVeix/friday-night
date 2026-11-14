-- Run within a transaction after admin-migration.sql. Roll back all verification data.
-- The runner sets friday.test_group to the installation's group code privately.
update watch_private.settings set admin_password_hash=extensions.crypt('admin-test-password-only',extensions.gen_salt('bf',10)) where singleton=true;
set local role anon;
do $test$
declare
  result jsonb;
  group_code text := current_setting('friday.test_group');
  item_id text;
begin
  begin
    perform public.watch_admin(group_code,'add_person','{"name":"Unauthorized"}'::jsonb);
    raise exception 'Group code authorized admin access';
  exception when others then if sqlerrm<>'Invalid admin password' then raise; end if; end;
  begin
    perform public.watch_admin('wrong-admin-password','list');
    raise exception 'Wrong password authorized admin access';
  exception when others then if sqlerrm<>'Invalid admin password' then raise; end if; end;
  begin
    perform count(*) from watch_private.people;
    raise exception 'Private people table exposed';
  exception when insufficient_privilege then null; end;
  result := public.watch_admin('admin-test-password-only','add_person','{"name":"  Admin   Verification  "}'::jsonb);
  if not result ? 'Admin Verification' then raise exception 'New person not returned'; end if;
  if not public.watch_people() ? 'Admin Verification' then raise exception 'New person missing from public names'; end if;
  if not (public.watch_api(group_code,'list')->'people') ? 'Admin Verification' then raise exception 'New person missing from watch list'; end if;
  begin
    perform public.watch_admin('admin-test-password-only','add_person','{"name":"admin verification"}'::jsonb);
    raise exception 'Case-insensitive duplicate accepted';
  exception when others then if sqlerrm<>'That name is already on the list' then raise; end if; end;
  begin
    perform public.watch_admin('admin-test-password-only','add_person','{"name":"  "}'::jsonb);
    raise exception 'Blank name accepted';
  exception when others then if sqlerrm<>'Enter a name between 1 and 40 characters' then raise; end if; end;
  result := public.watch_api(group_code,'list');item_id := result->'items'->0->>'id';
  perform public.watch_api(group_code,'vote',jsonb_build_object('id',item_id,'name','Admin Verification','interest','idc'));
  begin
    perform public.watch_api(group_code,'vote',jsonb_build_object('id',item_id,'name','Unlisted Person','interest','hold'));
    raise exception 'Unlisted person could vote';
  exception when others then if sqlerrm<>'Invalid name' then raise; end if; end;
  perform public.watch_admin('admin-test-password-only','change_password','{"password":"replacement-admin-password"}'::jsonb);
  begin
    perform public.watch_admin('admin-test-password-only','list');
    raise exception 'Old admin password still works';
  exception when others then if sqlerrm<>'Invalid admin password' then raise; end if; end;
  perform public.watch_admin('replacement-admin-password','list');
end;
$test$;
reset role;
