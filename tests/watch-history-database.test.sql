-- Disposable database only; schema, admin, personal-seen, and watch-history migrations required.
begin;
set local role anon;
do $$
declare
  code text := 'friday-night-test-code-only';
  item_id uuid;
  result jsonb;
  record_before jsonb;
  record_after jsonb;
  bad jsonb;
  previous_seen text;
begin
  result := public.watch_api(code,'list');
  if result->>'watch_details_version' <> '2' then raise exception 'History capability missing'; end if;
  begin
    perform public.watch_api('wrong-group-code','list');
    raise exception 'Wrong code accepted';
  exception when others then if sqlerrm <> 'Invalid group code' then raise; end if; end;
  begin
    perform watch_private.watch_context('{}');
    raise exception 'Private history helper was callable';
  exception when insufficient_privilege then null; end;

  perform public.watch_api(code,'add','{"items":[{"title":"Watch history test","type":"movie"}]}');
  select (i->>'id')::uuid into item_id from jsonb_array_elements(public.watch_api(code,'list')->'items') i where i->>'title'='Watch history test';
  perform public.watch_api(code,'vote',jsonb_build_object('id',item_id,'name','Alex','interest','hold'));
  perform public.watch_api(code,'seen',jsonb_build_object('id',item_id,'name','Alex','seen',true));
  select s->>'created_at' into previous_seen from jsonb_array_elements(public.watch_api(code,'list')->'seen') s where s->>'item_id'=item_id::text and s->>'name'='Alex';

  for bad in select value from jsonb_array_elements('[
    {"attendees":"Alex"},{"attendees":[42]},{"attendees":["Unknown person"]},
    {"recorded_by":"Unknown person"},{"time_zone":"Not/AZone"}
  ]'::jsonb) loop
    begin
      perform public.watch_api(code,'watched',jsonb_build_object('id',item_id,'watched',true)||bad);
      raise exception 'Invalid watch context accepted';
    exception when others then
      if sqlerrm='Invalid watch context accepted' then raise; end if;
    end;
  end loop;
  select i into record_after from jsonb_array_elements(public.watch_api(code,'list')->'items') i where i->>'id'=item_id::text;
  if (record_after->>'watched')::boolean then raise exception 'Failed validation changed watched status'; end if;

  perform public.watch_api(code,'watched',jsonb_build_object('id',item_id,'watched',true,'attendees',jsonb_build_array('Alex','Lyss','Alex'),'recorded_by','Alex','time_zone','America/New_York'));
  select i into record_before from jsonb_array_elements(public.watch_api(code,'list')->'items') i where i->>'id'=item_id::text;
  if record_before->>'watched_at' is null or (record_before->>'watched_on')::date <> (clock_timestamp() at time zone 'America/New_York')::date then raise exception 'Watch date missing or wrong time zone'; end if;
  if record_before->'watched_attendees' <> '["Alex","Lyss"]'::jsonb or record_before->>'watched_by' <> 'Alex' then raise exception 'Watch attendees/recorder missing'; end if;
  result := public.watch_api(code,'list');
  if (select count(*) from jsonb_array_elements(result->'seen') s where s->>'item_id'=item_id::text)<>2 then raise exception 'Attendees were not marked personally seen'; end if;
  if not exists(select 1 from jsonb_array_elements(result->'seen') s where s->>'item_id'=item_id::text and s->>'name'='Alex' and s->>'created_at'=previous_seen) then raise exception 'Existing seen timestamp was overwritten'; end if;
  perform public.watch_api(code,'watched',jsonb_build_object('id',item_id,'watched',true,'attendees',jsonb_build_array('Blue'),'recorded_by','Blue'));
  select i into record_after from jsonb_array_elements(public.watch_api(code,'list')->'items') i where i->>'id'=item_id::text;
  if record_before <> record_after then raise exception 'Duplicate save overwrote the snapshot'; end if;
  if exists(select 1 from jsonb_array_elements(public.watch_api(code,'list')->'seen') s where s->>'item_id'=item_id::text and s->>'name'='Blue') then raise exception 'Duplicate save marked a new attendee seen'; end if;

  perform public.watch_api(code,'progress',jsonb_build_object('id',item_id,'film','Film One (2000)','name','Group','watched',true,'attendees',jsonb_build_array('Alex','Lyss'),'recorded_by','Lyss','time_zone','Pacific/Kiritimati'));
  select p into record_before from jsonb_array_elements(public.watch_api(code,'list')->'progress') p where p->>'item_id'=item_id::text and p->>'name'='Group';
  if record_before->>'watched_at' is null or (record_before->>'watched_on')::date <> (clock_timestamp() at time zone 'Pacific/Kiritimati')::date then raise exception 'Checklist watch date missing'; end if;
  perform public.watch_api(code,'progress',jsonb_build_object('id',item_id,'film','Film One (2000)','name','Group','watched',true,'attendees',jsonb_build_array('Blue')));
  select p into record_after from jsonb_array_elements(public.watch_api(code,'list')->'progress') p where p->>'item_id'=item_id::text and p->>'name'='Group';
  if record_before <> record_after then raise exception 'Duplicate progress overwrote its snapshot'; end if;
  result := public.watch_api(code,'list');
  if (select count(*) from jsonb_array_elements(result->'progress') p where p->>'item_id'=item_id::text and p->>'film'='Film One (2000)' and p->>'name' in ('Alex','Lyss'))<>2 then raise exception 'Attendees did not receive personal film progress'; end if;
  if exists(select 1 from jsonb_array_elements(result->'progress') p where p->>'item_id'=item_id::text and p->>'name'='Blue') then raise exception 'Duplicate progress added a different attendee'; end if;
  perform public.watch_api(code,'progress',jsonb_build_object('id',item_id,'film','Film One (2000)','name','Alex','watched',true));
  perform public.watch_api(code,'progress',jsonb_build_object('id',item_id,'film','tv:42:1:1','name','Group','watched',true));
  select p into record_after from jsonb_array_elements(public.watch_api(code,'list')->'progress') p where p->>'item_id'=item_id::text and p->>'film'='tv:42:1:1';
  if record_after->>'watched_at' is null or record_after->'watched_attendees' <> 'null'::jsonb then raise exception 'Missing attendance was guessed'; end if;
  if exists(select 1 from jsonb_array_elements(public.watch_api(code,'list')->'progress') p where p->>'item_id'=item_id::text and p->>'film'='tv:42:1:1' and p->>'name'<>'Group') then raise exception 'Unselected people got personal episode progress'; end if;

  perform public.watch_api(code,'watched',jsonb_build_object('id',item_id,'watched',false));
  select i into record_after from jsonb_array_elements(public.watch_api(code,'list')->'items') i where i->>'id'=item_id::text;
  if record_after->>'watched_at' is not null or record_after->>'watched_on' is not null or record_after->>'watched_attendees' is not null then raise exception 'Undo kept stale watch metadata'; end if;
  perform public.watch_api(code,'progress',jsonb_build_object('id',item_id,'film','Film One (2000)','name','Group','watched',false));
  result := public.watch_api(code,'list');
  if exists(select 1 from jsonb_array_elements(result->'progress') p where p->>'item_id'=item_id::text and p->>'film'='Film One (2000)' and p->>'name'='Group') then raise exception 'Progress undo failed'; end if;
  if not exists(select 1 from jsonb_array_elements(result->'progress') p where p->>'item_id'=item_id::text and p->>'name'='Alex') then raise exception 'Group undo changed personal progress'; end if;
  if not exists(select 1 from jsonb_array_elements(result->'votes') v where v->>'item_id'=item_id::text and v->>'interest'='hold') then raise exception 'Watch metadata changed votes'; end if;
  if not exists(select 1 from jsonb_array_elements(result->'seen') s where s->>'item_id'=item_id::text and s->>'name'='Alex') then raise exception 'Group undo changed personal history'; end if;
  raise notice 'PASS: group watch timestamps, local days, attendee snapshots, validation, duplicate saves, checklist/episode history, undo, and private helpers';
end;
$$;
rollback;
