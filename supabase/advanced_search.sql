-- Tumeni Phase 6.7.1 — Advanced Product Search
-- Run this once in Supabase SQL Editor.
-- This adds database-backed search while preserving the existing Tumeni UI.

create or replace function public.search_products_advanced(
  p_query text,
  p_limit integer default 40,
  p_offset integer default 0
)
returns table (
  id uuid,
  name text,
  description text,
  price numeric,
  image_url text,
  category_id uuid,
  shop_id uuid,
  available boolean,
  created_at timestamptz,
  category text,
  shop text,
  rating numeric,
  relevance numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    select lower(trim(coalesce(p_query, ''))) as term
  ),
  ranked as (
    select
      p.id,
      p.name,
      p.description,
      p.price,
      p.image_url,
      p.category_id,
      p.shop_id,
      p.available,
      p.created_at,
      c.name as category,
      s.name as shop,
      coalesce(avg(pr.rating), 0)::numeric as rating,
      (
        case when lower(p.name) = q.term and q.term <> '' then 100 else 0 end +
        case when q.term <> '' and lower(p.name) like q.term || '%' then 60 else 0 end +
        case when q.term <> '' and lower(coalesce(p.name,'')) like '%' || q.term || '%' then 35 else 0 end +
        case when q.term <> '' and lower(coalesce(p.description,'')) like '%' || q.term || '%' then 20 else 0 end +
        case when q.term <> '' and lower(coalesce(c.name,'')) like '%' || q.term || '%' then 15 else 0 end +
        case when q.term <> '' and lower(coalesce(s.name,'')) like '%' || q.term || '%' then 10 else 0 end
      )::numeric as relevance
    from public.products p
    cross join q
    left join public.categories c on c.id = p.category_id
    left join public.shops s on s.id = p.shop_id
    left join public.product_reviews pr on pr.product_id = p.id
    where p.available = true
      and (
        q.term = '' or
        lower(coalesce(p.name,'')) like '%' || q.term || '%' or
        lower(coalesce(p.description,'')) like '%' || q.term || '%' or
        lower(coalesce(c.name,'')) like '%' || q.term || '%' or
        lower(coalesce(s.name,'')) like '%' || q.term || '%'
      )
    group by p.id, c.name, s.name, q.term
  )
  select id,name,description,price,image_url,category_id,shop_id,available,created_at,category,shop,rating,relevance
  from ranked
  order by relevance desc, rating desc, created_at desc
  limit greatest(1, least(coalesce(p_limit, 40), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.search_products_advanced(text, integer, integer) from public;
revoke all on function public.search_products_advanced(text, integer, integer) from anon;
grant execute on function public.search_products_advanced(text, integer, integer) to authenticated;

notify pgrst, 'reload schema';
