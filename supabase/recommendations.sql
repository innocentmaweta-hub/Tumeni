-- Tumeni Phase 6.2B: personalized recommendation engine.
-- Run this once in the Supabase SQL Editor.

create or replace function public.get_personalized_recommendations(p_limit integer default 8)
returns table (
  id uuid,
  name text,
  description text,
  price numeric,
  image_url text,
  shop_id uuid,
  shop text,
  category_id uuid,
  category text,
  recommendation_score numeric,
  recommendation_reason text
)
language sql
stable
security invoker
as $function$
with
event_scores as (
  select e.product_id,
    sum((case e.event_type when 'favorite_add' then 8 when 'cart_add' then 7 when 'product_click' then 4 when 'product_view' then 2 else 0 end)
      * greatest(0.15, 1 - extract(epoch from (now() - e.created_at)) / 2592000.0)) as direct_score
  from public.customer_behavior_events e
  where e.customer_id = auth.uid() and e.product_id is not null and e.created_at >= now() - interval '30 days'
  group by e.product_id
),
category_scores as (
  select p.category_id,
    sum((case e.event_type when 'favorite_add' then 6 when 'cart_add' then 5 when 'product_click' then 3 when 'product_view' then 1 else 0 end)
      * greatest(0.15, 1 - extract(epoch from (now() - e.created_at)) / 2592000.0)) as category_score
  from public.customer_behavior_events e
  join public.products p on p.id=e.product_id
  where e.customer_id=auth.uid() and p.category_id is not null and e.created_at >= now() - interval '30 days'
  group by p.category_id
),
shop_scores as (
  select p.shop_id,
    sum((case e.event_type when 'favorite_add' then 4 when 'cart_add' then 4 when 'product_click' then 2 when 'product_view' then 1 else 0 end)
      * greatest(0.15, 1 - extract(epoch from (now() - e.created_at)) / 2592000.0)) as shop_score
  from public.customer_behavior_events e
  join public.products p on p.id=e.product_id
  where e.customer_id=auth.uid() and p.shop_id is not null and e.created_at >= now() - interval '30 days'
  group by p.shop_id
),
popular as (
  select e.product_id,
    sum((case e.event_type when 'favorite_add' then 5 when 'cart_add' then 4 when 'product_click' then 2 when 'product_view' then 1 else 0 end)
      * greatest(0.15, 1 - extract(epoch from (now() - e.created_at)) / 2592000.0)) as popularity_score
  from public.customer_behavior_events e
  where e.product_id is not null and e.created_at >= now() - interval '30 days'
  group by e.product_id
),
purchased as (
  select distinct oi.product_id
  from public.order_items oi
  join public.orders o on o.id=oi.order_id
  where o.customer_id=auth.uid() and oi.product_id is not null
    and o.status not in ('cancelled','refunded')
),
scored as (
  select p.id,p.name,p.description,p.price,p.image_url,p.shop_id,
    coalesce(s.name,'Admin Product') as shop,p.category_id,coalesce(c.name,'Other') as category,
    round((coalesce(es.direct_score,0)+coalesce(cs.category_score,0)*0.65+coalesce(ss.shop_score,0)*0.35+coalesce(pop.popularity_score,0)*0.25)::numeric,3) as recommendation_score,
    case
      when coalesce(es.direct_score,0)>0 then 'Based on your recent activity'
      when coalesce(cs.category_score,0)>0 then 'Based on categories you explore'
      when coalesce(ss.shop_score,0)>0 then 'Based on shops you interact with'
      else 'Popular on Tumeni'
    end as recommendation_reason
  from public.products p
  left join public.shops s on s.id=p.shop_id
  left join public.categories c on c.id=p.category_id
  left join event_scores es on es.product_id=p.id
  left join category_scores cs on cs.category_id=p.category_id
  left join shop_scores ss on ss.shop_id=p.shop_id
  left join popular pop on pop.product_id=p.id
  where p.available=true and p.stock_quantity>0
    and not exists(select 1 from purchased x where x.product_id=p.id)
)
select * from scored
order by recommendation_score desc,name asc
limit greatest(1,least(coalesce(p_limit,8),24));
$function$;

revoke all on function public.get_personalized_recommendations(integer) from public;
grant execute on function public.get_personalized_recommendations(integer) to authenticated;
