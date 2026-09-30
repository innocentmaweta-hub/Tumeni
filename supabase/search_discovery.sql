-- Tumeni Phase 6.7.3 — Search discovery and analytics
create or replace function public.get_popular_searches(p_limit integer default 8)
returns table(search_query text, search_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select lower(trim(search_query)) as search_query, count(*)::bigint as search_count
  from public.customer_behavior_events
  where event_type = 'search'
    and search_query is not null
    and trim(search_query) <> ''
    and created_at >= now() - interval '30 days'
  group by lower(trim(search_query))
  order by count(*) desc, lower(trim(search_query)) asc
  limit greatest(1, least(coalesce(p_limit, 8), 20));
$$;
revoke all on function public.get_popular_searches(integer) from public;
revoke all on function public.get_popular_searches(integer) from anon;
grant execute on function public.get_popular_searches(integer) to authenticated;
notify pgrst, 'reload schema';
