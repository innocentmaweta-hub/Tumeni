-- Tumeni Phase 6.8.1 — Customer retention foundation
create or replace function public.get_my_retention_summary()
returns table(
  lifecycle text,
  delivered_orders bigint,
  last_order_at timestamptz,
  last_activity_at timestamptz,
  days_since_order integer,
  days_since_activity integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with me as (select auth.uid() as id),
  order_stats as (
    select count(*) filter (where o.status='delivered')::bigint as delivered_orders,
           max(o.created_at) filter (where o.status='delivered') as last_order_at
    from public.orders o join me on me.id=o.customer_id
  ),
  behavior_stats as (
    select max(created_at) as last_activity_at
    from public.customer_behavior_events b join me on me.id=b.customer_id
  ),
  combined as (
    select os.*, bs.last_activity_at,
      greatest(coalesce(os.last_order_at,'epoch'::timestamptz),coalesce(bs.last_activity_at,'epoch'::timestamptz)) as latest_at
    from order_stats os cross join behavior_stats bs
  )
  select
    case
      when delivered_orders=0 and latest_at > now()-interval '7 days' then 'new_active'
      when delivered_orders=0 then 'new'
      when last_order_at >= now()-interval '30 days' and delivered_orders >= 4 then 'high_frequency'
      when last_order_at < now()-interval '60 days' then 'at_risk'
      when last_order_at < now()-interval '30 days' then 'inactive'
      else 'returning'
    end as lifecycle,
    delivered_orders,last_order_at,last_activity_at,
    case when last_order_at is null then null else greatest(0,floor(extract(epoch from now()-last_order_at)/86400))::integer end,
    case when last_activity_at is null then null else greatest(0,floor(extract(epoch from now()-last_activity_at)/86400))::integer end
  from combined;
$$;
revoke all on function public.get_my_retention_summary() from public;
revoke all on function public.get_my_retention_summary() from anon;
grant execute on function public.get_my_retention_summary() to authenticated;
notify pgrst, 'reload schema';
