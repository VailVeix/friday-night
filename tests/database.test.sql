-- Disposable database only. Apply schema.sql with the test code and seed.sql first.
set role anon;
do $$
declare
  result jsonb;
  test_code text := 'friday-night-test-code-only';
  first_id text := '00000000-0000-4000-8000-000000000001';
begin
  begin
    perform public.watch_api('incorrect-code-long-enough','list');
    raise exception 'Wrong group code was accepted';
  exception when others then
    if sqlerrm <> 'Invalid group code' then raise; end if;
  end;
  begin
    perform count(*) from watch_private.items;
    raise exception 'Private tables were readable by anon';
  exception when insufficient_privilege then null;
  end;
  result := public.watch_api(test_code,'list');
  if jsonb_array_length(result->'items')<>46 then raise exception 'Incorrect seed count'; end if;
  perform public.watch_api(test_code,'vote',jsonb_build_object('id',first_id,'name','Alex','interest','idc'));
  result := public.watch_api(test_code,'list');
  if result->'votes'->0->>'interest'<>'idc' then raise exception 'IDC not saved'; end if;
  perform public.watch_api(test_code,'vote',jsonb_build_object('id',first_id,'name','Alex','interest','hold'));
  result := public.watch_api(test_code,'list');
  if jsonb_array_length(result->'votes')<>1 or result->'votes'->0->>'interest'<>'hold' then raise exception 'Vote replacement failed'; end if;
  perform public.watch_api(test_code,'progress',jsonb_build_object('id',first_id,'film','Test film (2000)','name','Group','watched',true));
  perform public.watch_api(test_code,'progress',jsonb_build_object('id',first_id,'film','Test film (2000)','name','Alex','watched',true));
  perform public.watch_api(test_code,'progress',jsonb_build_object('id',first_id,'film','Test film (2000)','name','Alex','watched',false));
  result := public.watch_api(test_code,'list');
  if jsonb_array_length(result->'progress')<>1 or result->'progress'->0->>'name'<>'Group' then raise exception 'Independent progress failed'; end if;
  perform public.watch_api(test_code,'watched',jsonb_build_object('id',first_id,'watched',true));
  result := public.watch_api(test_code,'list');
  if not exists(select 1 from jsonb_array_elements(result->'items') i where i->>'id'=first_id and (i->>'watched')::boolean) then raise exception 'Archive failed'; end if;
  perform public.watch_api(test_code,'add','{"items":[{"title":"Database test series","type":"series","films":[["Film One",2000]]}]}'::jsonb);
  result := public.watch_api(test_code,'list');
  if jsonb_array_length(result->'items')<>47 then raise exception 'Adding title failed'; end if;
  if not exists(select 1 from jsonb_array_elements(result->'items') i where i->>'title'='Database test series' and i->'films'='[["Film One",2000]]'::jsonb and i->>'created_at' is not null) then raise exception 'Series or date missing'; end if;
  raise notice 'PASS: database authorization, private table access, seed, votes, IDC, progress, archive, series, and timestamps';
end;
$$;
reset role;
