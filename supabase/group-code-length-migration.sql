-- Allow host-selected group codes of 8-100 characters on existing installations.
-- Preserve the existing function, data, and group-code hash.
do $migration$
declare
  definition text := pg_get_functiondef('public.watch_api(text,text,jsonb)'::regprocedure);
begin
  if strpos(definition, 'length(p_code) < 16') > 0 then
    execute replace(definition, 'length(p_code) < 16', 'length(p_code) < 8');
  elsif strpos(definition, 'length(p_code) < 8') = 0 then
    raise exception 'Unexpected group-code validation; inspect before migrating';
  end if;
end;
$migration$;
