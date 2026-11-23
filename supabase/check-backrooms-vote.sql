-- Read-only diagnosis. Run in Supabase SQL Editor to inspect Alex's saved vote.
-- Shows every matching title ID, including similarly named versions or duplicates.
select
  i.id, i.title, i.year, i.watched,
  v.name as vote_saved_under,
  v.interest as stored_vote,
  case v.interest
    when 'hold' then 'Wait for me'
    when 'interested' then 'Yes'
    when 'idc' then 'Either way'
    when 'pass' then 'Nope !'
    else 'No saved vote for Alex on this title ID'
  end as saved_choice,
  exists(select 1 from watch_private.seen s
    where s.item_id=i.id and lower(btrim(s.name))='alex') as personally_seen_by_alex
from watch_private.items i
left join watch_private.votes v on v.item_id=i.id and lower(btrim(v.name))='alex'
where i.title ilike '%backrooms%' or i.original_title ilike '%backrooms%'
order by i.created_at,i.id,v.name;
