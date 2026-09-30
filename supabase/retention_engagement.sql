-- Tumeni Phase 6.8.2 — Retention engagement notifications
create or replace function public.trigger_my_retention_engagement()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  delivered_count bigint := 0;
  last_order timestamptz;
  latest_activity timestamptz;
  lifecycle text;
  inserted_count integer := 0;
begin
  if uid is null then return jsonb_build_object('created',false,'reason','not_authenticated'); end if;
  select count(*) filter (where status='delivered'), max(created_at) filter (where status='delivered')
    into delivered_count,last_order from public.orders where customer_id=uid;
  select max(created_at) into latest_activity from public.customer_behavior_events where customer_id=uid;
  lifecycle := case
    when delivered_count=0 and greatest(coalesce(last_order,'epoch'::timestamptz),coalesce(latest_activity,'epoch'::timestamptz)) > now()-interval '7 days' then 'new_active'
    when delivered_count=0 then 'new'
    when last_order >= now()-interval '30 days' and delivered_count >= 4 then 'high_frequency'
    when last_order < now()-interval '60 days' then 'at_risk'
    when last_order < now()-interval '30 days' then 'inactive'
    else 'returning' end;

  if lifecycle in ('at_risk','inactive') then
    if not exists(select 1 from public.notifications where recipient_id=uid and notification_type='retention' and created_at >= now()-interval '7 days') then
      insert into public.notifications(recipient_id,notification_type,title,message,metadata)
      values(uid,'retention','Welcome back to Tumeni','We have products and services ready when you need them.',jsonb_build_object('lifecycle',lifecycle));
      inserted_count := 1;
    end if;
  elsif lifecycle='new' then
    if not exists(select 1 from public.notifications where recipient_id=uid and notification_type='retention' and created_at >= now()-interval '3 days') then
      insert into public.notifications(recipient_id,notification_type,title,message,metadata)
      values(uid,'retention','Welcome to Tumeni','Explore products, services and delivery options available to you.',jsonb_build_object('lifecycle',lifecycle));
      inserted_count := 1;
    end if;
  end if;
  return jsonb_build_object('created',inserted_count>0,'count',inserted_count,'lifecycle',lifecycle);
end;
$$;
revoke all on function public.trigger_my_retention_engagement() from public;
revoke all on function public.trigger_my_retention_engagement() from anon;
grant execute on function public.trigger_my_retention_engagement() to authenticated;
notify pgrst, 'reload schema';
