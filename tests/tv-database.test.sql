-- Runner sets friday.test_group privately and rolls back the whole transaction.
do $setup$
declare test_id uuid := gen_random_uuid();
begin
  insert into watch_private.items(id,title,type) values(test_id,'Temporary TV tracker verification '||test_id,'tv');
  perform set_config('friday.tv_id',test_id::text,true);
end;
$setup$;
set local role anon;
do $test$
declare
  group_code text := current_setting('friday.test_group');
  item_id text := current_setting('friday.tv_id');
  result jsonb;
begin
  begin
    perform public.watch_api('incorrect-group-code','progress',jsonb_build_object('id',item_id,'film','tv:42:1:1','name','Group','watched',true));
    raise exception 'Wrong code could save episode progress';
  exception when others then if sqlerrm<>'Invalid group code' then raise; end if; end;
  perform public.watch_api(group_code,'vote',jsonb_build_object('id',item_id,'name','Alex','interest','hold'));
  perform public.watch_api(group_code,'progress',jsonb_build_object('id',item_id,'film','tv:42:1:1','name','Group','watched',true));
  perform public.watch_api(group_code,'progress',jsonb_build_object('id',item_id,'film','tv:42:1:1','name','Group','watched',true));
  perform public.watch_api(group_code,'progress',jsonb_build_object('id',item_id,'film','tv:42:1:1','name','Alex','watched',true));
  perform public.watch_api(group_code,'progress',jsonb_build_object('id',item_id,'film','tv:42:2:1','name','Alex','watched',true));
  perform public.watch_api(group_code,'progress',jsonb_build_object('id',item_id,'film','tv:42:0:1','name','Alex','watched',true));
  result := public.watch_api(group_code,'list');
  if (select count(*) from jsonb_array_elements(result->'progress') p where p->>'item_id'=item_id)<>4 then raise exception 'Episodes, seasons, or people collided'; end if;
  if exists(select 1 from jsonb_array_elements(result->'seen') s where s->>'item_id'=item_id) then raise exception 'Episode tracking changed personal seen'; end if;
  if not exists(select 1 from jsonb_array_elements(result->'items') i where i->>'id'=item_id and (i->>'watched')::boolean=false) then raise exception 'Episode tracking changed group archive'; end if;
  perform public.watch_api(group_code,'watched',jsonb_build_object('id',item_id,'watched',true));
  perform public.watch_api(group_code,'watched',jsonb_build_object('id',item_id,'watched',false));
  perform public.watch_api(group_code,'progress',jsonb_build_object('id',item_id,'film','tv:42:1:1','name','Alex','watched',false));
  result := public.watch_api(group_code,'list');
  if (select count(*) from jsonb_array_elements(result->'progress') p where p->>'item_id'=item_id)<>3 then raise exception 'Undo or archive lost other progress'; end if;
  if not exists(select 1 from jsonb_array_elements(result->'progress') p where p->>'item_id'=item_id and p->>'name'='Group' and p->>'film'='tv:42:1:1') then raise exception 'Personal undo changed group progress'; end if;
  if not exists(select 1 from jsonb_array_elements(result->'votes') v where v->>'item_id'=item_id and v->>'interest'='hold') then raise exception 'Vote changed'; end if;
end;
$test$;
reset role;
