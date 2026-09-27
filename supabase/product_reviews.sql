-- Tumeni product ratings and comments  
-- Run this once in the Supabase SQL Editor if the main schema has already been applied.

create table if not exists public.product_reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  reviewer_name text not null,
  rating integer not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id, customer_id)
);

create index if not exists product_reviews_product_id_idx on public.product_reviews(product_id);
create index if not exists product_reviews_customer_id_idx on public.product_reviews(customer_id);

alter table public.product_reviews enable row level security;

drop policy if exists "public can view product reviews" on public.product_reviews;
create policy "public can view product reviews"
on public.product_reviews for select
to anon, authenticated
using (true);

drop policy if exists "users can create product reviews" on public.product_reviews;
create policy "users can create product reviews"
on public.product_reviews for insert
to authenticated
with check (auth.uid() = customer_id);

drop policy if exists "users can update own product reviews" on public.product_reviews;
create policy "users can update own product reviews"
on public.product_reviews for update
to authenticated
using (auth.uid() = customer_id)
with check (auth.uid() = customer_id);

drop policy if exists "users can delete own product reviews" on public.product_reviews;
create policy "users can delete own product reviews"
on public.product_reviews for delete
to authenticated
using (auth.uid() = customer_id);

grant select on table public.product_reviews to anon, authenticated;
grant insert, update, delete on table public.product_reviews to authenticated;

drop trigger if exists product_reviews_updated_at on public.product_reviews;
create trigger product_reviews_updated_at
before update on public.product_reviews
for each row execute procedure public.set_updated_at();

notify pgrst, 'reload schema';
