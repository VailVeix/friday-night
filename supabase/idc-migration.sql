-- Existing installations: allow the neutral IDC response. Existing votes stay intact.
begin;
alter table watch_private.votes drop constraint if exists votes_interest_check;
alter table watch_private.votes add constraint votes_interest_check check (interest in ('pass','interested','hold','idc'));
commit;
