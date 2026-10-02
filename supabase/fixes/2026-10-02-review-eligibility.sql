-- Require a delivered order containing the product before a customer can review it.
-- Safe to run more than once.

create or replace function public.can_customer_review_product(p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select exists (
    select 1
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where oi.product_id = p_product_id
      and o.customer_id = auth.uid()
      and o.status = 'delivered'
  );
$function$;

revoke all on function public.can_customer_review_product(uuid) from public;
grant execute on function public.can_customer_review_product(uuid) to authenticated;

drop policy if exists "users can create product reviews" on public.product_reviews;
create policy "users can create product reviews"
on public.product_reviews for insert
to authenticated
with check (
  auth.uid() = customer_id
  and public.can_customer_review_product(product_id)
);

drop policy if exists "users can update own product reviews" on public.product_reviews;
create policy "users can update own product reviews"
on public.product_reviews for update
to authenticated
using (auth.uid() = customer_id)
with check (
  auth.uid() = customer_id
  and public.can_customer_review_product(product_id)
);

notify pgrst, 'reload schema';
