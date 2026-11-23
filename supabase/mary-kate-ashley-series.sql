-- Run in Supabase SQL Editor after watch-history-migration.sql.
-- Consolidates existing Mary-Kate & Ashley movies into ONE regular film series.
-- Individual movie entries and their votes are removed, as requested.
-- Group watch details and personal viewing progress become series checklist entries.
-- Other titles and any existing series-level votes are untouched. Safe to rerun.
begin;
lock table watch_private.items,watch_private.votes,watch_private.seen,watch_private.progress
  in share row exclusive mode;

create temporary table olsen_films(position integer,title text,year text) on commit drop;
insert into olsen_films values
  (1,'To Grandmother''s House We Go','1992'),
  (2,'Double, Double, Toil and Trouble','1993'),
  (3,'How the West Was Fun','1994'),
  (4,'It Takes Two','1995'),
  (5,'Billboard Dad','1998'),
  (6,'Passport to Paris','1999'),
  (7,'Switching Goals','1999'),
  (8,'Our Lips Are Sealed','2000'),
  (9,'Winning London','2001'),
  (10,'Holiday in the Sun','2001'),
  (11,'Getting There','2002'),
  (12,'When in Rome','2002'),
  (13,'The Challenge','2003'),
  (14,'New York Minute','2004');

create temporary table olsen_members on commit drop as
select i.*,f.title as film_title,f.year as film_year,f.position
from watch_private.items i
join olsen_films f on i.year=f.year and exists(
  select 1 from unnest(array[i.title,i.original_title]) as candidate(title)
  where regexp_replace(regexp_replace(lower(candidate.title),'(\s*\(([0-9]{4}|rewatch)\))+\s*$','','g'),'[^a-z0-9]','','g')
    =regexp_replace(lower(f.title),'[^a-z0-9]','','g')
)
where i.type='movie';

do $$
declare
  parent_id uuid;
  merged_films jsonb;
begin
  select id into parent_id from watch_private.items
    where type='series' and lower(title)=lower('Mary-Kate & Ashley');
  if parent_id is not null then
    update watch_private.items set overview='Mary-Kate and Ashley movies — curated by Alex.' where id=parent_id;
  end if;
  if not exists(select 1 from olsen_members) then
    if parent_id is not null then return; end if;
    raise exception 'No matching Mary-Kate & Ashley movies found. No data changed.';
  end if;

  if parent_id is null then
    insert into watch_private.items(title,type,poster_path,overview,films,created_at)
    values('Mary-Kate & Ashley','series',
      (select poster_path from olsen_members where poster_path is not null order by position limit 1),
      'Mary-Kate and Ashley movies — curated by Alex.',
      '[]'::jsonb,(select min(created_at) from olsen_members))
    returning id into parent_id;
  end if;

  select jsonb_agg(f.film order by (f.film->>1)::integer,coalesce(o.position,100),f.film->>0)
  into merged_films
  from (
    select distinct value as film from jsonb_array_elements(
      (select case when jsonb_typeof(films)='array' then films else '[]'::jsonb end
        from watch_private.items where id=parent_id)
      || (select jsonb_agg(jsonb_build_array(film_title,film_year::integer)) from olsen_members)
    )
  ) f left join olsen_films o on o.title=f.film->>0 and o.year=f.film->>1;
  update watch_private.items set films=merged_films where id=parent_id;

  insert into watch_private.progress(item_id,film,name,watched_at,watched_on,watched_attendees,watched_by)
  select parent_id,m.film_title||' ('||m.film_year||')','Group',
    m.watched_at,m.watched_on,m.watched_attendees,m.watched_by
  from olsen_members m where m.watched
  on conflict do nothing;

  insert into watch_private.progress(item_id,film,name,watched_at,watched_on,watched_attendees,watched_by)
  select parent_id,m.film_title||' ('||m.film_year||')',p.name,
    p.watched_at,p.watched_on,p.watched_attendees,p.watched_by
  from olsen_members m join watch_private.progress p on p.item_id=m.id
  on conflict do nothing;

  insert into watch_private.progress(item_id,film,name,watched_at)
  select parent_id,m.film_title||' ('||m.film_year||')',s.name,s.created_at
  from olsen_members m join watch_private.seen s on s.item_id=m.id
  on conflict do nothing;

  -- Foreign-key cascades remove the individual movie votes and superseded rows.
  delete from watch_private.items where id in(select id from olsen_members);
end;
$$;

select i.id,i.title,i.type,jsonb_array_length(i.films) as films,
  (select count(*) from olsen_members) as individual_movies_consolidated
from watch_private.items i where i.type='series' and lower(i.title)=lower('Mary-Kate & Ashley');
commit;
