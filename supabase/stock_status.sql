-- Tumeni: explicit seller-controlled stock status
-- Run once in Supabase SQL Editor.

alter table public.products
  add column if not exists out_of_stock boolean not null default false;

-- Existing products are NOT considered explicitly out of stock.
update public.products
set out_of_stock = false
where out_of_stock is null;

notify pgrst, 'reload schema';
