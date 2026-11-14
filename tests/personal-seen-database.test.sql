-- Run after personal-seen-migration.sql in a transaction and roll back afterward.
-- The runner sets friday.test_group privately.
do $setup$
declare test_id uuid := gen_random_uuid();
begin
  insert into watch_private.items(id,title,type) values(test_id,'Temporary personal history verification '||test_id,'movie');
  perform set_config('friday.seen_id',test_id::text,true);
end;
$setup$;
set local role anon;
do $test$
declare
  group_code text := current_setting('friday.test_group');
  item_id text := current_setting('friday.seen_id');
  result jsonb;
begin
  begin
    perform count(*) from watch_private.seen;
    raise exception 'Personal history table exposed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.watch_api('incorrect-group-code','seen',jsonb_build_object('id',item_id,'name','Alex','seen',true));
    raise exception 'Wrong code could save personal history';
  exception when others then if sqlerrm<>'Invalid group code' then raise; end if; end;
  begin
    perform public.watch_api(group_code,'seen',jsonb_build_object('id',item_id,'name','Unlisted Person','seen',true));
    raise exception 'Unlisted name accepted';
  exception when others then if sqlerrm<>'Invalid name' then raise; end if; end;
  begin
    perform public.watch_api(group_code,'seen',jsonb_build_object('id',item_id,'name','Alex','seen','yes'));
    raise exception 'Non-boolean status accepted';
  exception when others then if sqlerrm<>'Invalid seen status' then raise; end if; end;
  perform public.watch_api(group_code,'vote',jsonb_build_object('id',item_id,'name','Alex','interest','hold'));
  perform public.watch_api(group_code,'seen',jsonb_build_object('id',item_id,'name','Alex','seen',true));
  perform public.watch_api(group_code,'seen',jsonb_build_object('id',item_id,'name','Alex','seen',true));
  perform public.watch_api(group_code,'seen',jsonb_build_object('id',item_id,'name','Michelle','seen',true));
  result := public.watch_api(group_code,'list');
  if (select count(*) from jsonb_array_elements(result->'seen') s where s->>'item_id'=item_id)<>2 then raise exception 'Personal statuses not saved independently'; end if;
  if not exists(select 1 from jsonb_array_elements(result->'votes') v where v->>'item_id'=item_id and v->>'name'='Alex' and v->>'interest'='hold') then raise exception 'Vote changed'; end if;
  if not exists(select 1 from jsonb_array_elements(result->'items') i where i->>'id'=item_id and (i->>'watched')::boolean=false) then raise exception 'Group archive changed'; end if;
  perform public.watch_api(group_code,'watched',jsonb_build_object('id',item_id,'watched',true));
  perform public.watch_api(group_code,'watched',jsonb_build_object('id',item_id,'watched',false));
  perform public.watch_api(group_code,'seen',jsonb_build_object('id',item_id,'name','Alex','seen',false));
  result := public.watch_api(group_code,'list');
  if (select count(*) from jsonb_array_elements(result->'seen') s where s->>'item_id'=item_id)<>1 then raise exception 'Undo affected another person'; end if;
  if not exists(select 1 from jsonb_array_elements(result->'seen') s where s->>'item_id'=item_id and s->>'name'='Michelle') then raise exception 'Other personal status lost'; end if;
end;
$test$;
reset role;
