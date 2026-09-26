-- Tumeni Phase 1 database
-- Safe to run in the Supabase SQL Editor more than once.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role' and typnamespace = 'public'::regnamespace) then
    create type public.user_role as enum ('customer','admin','partner','agent');
  end if;

  if not exists (select 1 from pg_type where typname = 'order_type' and typnamespace = 'public'::regnamespace) then
    create type public.order_type as enum ('purchase','task');
  end if;

  if not exists (select 1 from pg_type where typname = 'order_status' and typnamespace = 'public'::regnamespace) then
    create type public.order_status as enum (
      'pending_payment','paid','assigned','preparing','shopping',
      'picked_up','on_the_way','delivered','cancelled','failed','refunded'
    );
  end if;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  role public.user_role not null default 'customer',
  created_at timestamptz not null default now()
);

-- Existing databases may have an older profiles table without role.
alter table public.profiles
  add column if not exists role public.user_role not null default 'customer';

create table if not exists public.shops (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id) on delete set null,
  name text not null,
  description text,
  location text,
  contact_phone text,
  opening_hours jsonb,
  partnership_status text not null default 'active',
  created_at timestamptz not null default now()
);

alter table public.shops add column if not exists owner_id uuid references public.profiles(id) on delete set null;

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  image_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  name text not null,
  description text,
  price numeric(12,2) not null check (price >= 0),
  image_url text,
  available boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  label text,
  address_line text not null,
  area text,
  city text,
  latitude double precision,
  longitude double precision,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

-- Persistent customer cart. The current UI may still keep a local copy,
-- but the database is ready for cart persistence across devices.
create table if not exists public.carts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null unique references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(cart_id, product_id)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id),
  order_number text not null unique default ('TM-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))),
  order_type public.order_type not null,
  status public.order_status not null default 'pending_payment',
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  service_fee numeric(12,2) not null default 0 check (service_fee >= 0),
  delivery_fee numeric(12,2) not null default 0 check (delivery_fee >= 0),
  handling_fee numeric(12,2) not null default 0 check (handling_fee >= 0),
  total numeric(12,2) not null default 0 check (total >= 0),
  delivery_address_id uuid references public.addresses(id),
  task_description text,
  customer_notes text,
  payment_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id),
  shop_id uuid references public.shops(id),
  product_name text not null,
  unit_price numeric(12,2) not null check (unit_price >= 0),
  quantity integer not null check (quantity > 0),
  line_total numeric(12,2) generated always as (unit_price * quantity) stored
);

create table if not exists public.pricing_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  rule_type text not null,
  amount numeric(12,2) not null default 0,
  percentage numeric(7,3) not null default 0,
  conditions jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  raw_request text not null,
  ai_interpretation jsonb,
  quoted_amount numeric(12,2),
  customer_approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  provider text not null,
  provider_reference text,
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null default 'MWK',
  status text not null default 'pending',
  raw_response jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.order_assignments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  agent_id uuid references public.profiles(id),
  assigned_at timestamptz not null default now(),
  accepted_at timestamptz,
  completed_at timestamptz
);

create table if not exists public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  status public.order_status not null,
  note text,
  changed_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists products_shop_id_idx on public.products(shop_id);
create index if not exists products_category_id_idx on public.products(category_id);
create index if not exists addresses_customer_id_idx on public.addresses(customer_id);
create index if not exists orders_customer_id_idx on public.orders(customer_id);
create index if not exists orders_status_idx on public.orders(status);
create index if not exists order_items_order_id_idx on public.order_items(order_id);
create index if not exists cart_items_cart_id_idx on public.cart_items(cart_id);
create index if not exists cart_items_product_id_idx on public.cart_items(product_id);
create index if not exists payments_order_id_idx on public.payments(order_id);
create index if not exists tasks_order_id_idx on public.tasks(order_id);
create index if not exists order_assignments_order_id_idx on public.order_assignments(order_id);
create index if not exists order_assignments_agent_id_idx on public.order_assignments(agent_id);
create index if not exists order_status_history_order_id_idx on public.order_status_history(order_id);

-- Keep updated_at fields current whenever a row changes.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
-- profiles intentionally has no updated_at column, so no trigger is attached.

drop trigger if exists products_updated_at on public.products;
create trigger products_updated_at
before update on public.products
for each row execute procedure public.set_updated_at();

drop trigger if exists orders_updated_at on public.orders;
create trigger orders_updated_at
before update on public.orders
for each row execute procedure public.set_updated_at();

drop trigger if exists carts_updated_at on public.carts;
create trigger carts_updated_at
before update on public.carts
for each row execute procedure public.set_updated_at();

drop trigger if exists cart_items_updated_at on public.cart_items;
create trigger cart_items_updated_at
before update on public.cart_items
for each row execute procedure public.set_updated_at();

-- Create a profile automatically when Supabase Auth creates a user.
-- Also copies the phone number supplied during signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  requested_role text;
begin
  requested_role := case
    when lower(coalesce(new.email,'')) = 'innocentmaweta@gmail.com' then 'admin'
    when new.raw_user_meta_data->>'account_type' = 'seller' then 'partner'
    else 'customer'
  end;

  insert into public.profiles (id, full_name, phone, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.raw_user_meta_data->>'phone',
    requested_role::public.user_role
  )
  on conflict (id) do update
    set full_name = coalesce(excluded.full_name, public.profiles.full_name),
        phone = coalesce(excluded.phone, public.profiles.phone);
  return new;
end;
$function$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Enable Row Level Security.
alter table public.profiles enable row level security;
alter table public.shops enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.addresses enable row level security;
alter table public.carts enable row level security;
alter table public.cart_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.tasks enable row level security;
alter table public.payments enable row level security;
alter table public.order_assignments enable row level security;
alter table public.pricing_rules enable row level security;
alter table public.order_status_history enable row level security;

-- Recreate policies so this file is safe to re-run.
drop policy if exists "public can view active shops" on public.shops;
create policy "public can view active shops"
on public.shops for select
using (partnership_status = 'active');

drop policy if exists "public can view categories" on public.categories;
create policy "public can view categories"
on public.categories for select
using (true);

drop policy if exists "admins can create categories" on public.categories;
create policy "admins can create categories"
on public.categories for insert
with check (public.current_user_role() = 'admin');

drop policy if exists "admins can update categories" on public.categories;
create policy "admins can update categories"
on public.categories for update
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

drop policy if exists "admins can delete categories" on public.categories;
create policy "admins can delete categories"
on public.categories for delete
using (public.current_user_role() = 'admin');

drop policy if exists "public can view available products" on public.products;
create policy "public can view available products"
on public.products for select
using (available = true);

drop policy if exists "users can view own profile" on public.profiles;
create policy "users can view own profile"
on public.profiles for select
using (auth.uid() = id);

drop policy if exists "users can update own profile" on public.profiles;
create policy "users can update own profile"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "users can manage own addresses" on public.addresses;
create policy "users can manage own addresses"
on public.addresses for all
using (auth.uid() = customer_id)
with check (auth.uid() = customer_id);

drop policy if exists "users can manage own cart" on public.carts;
create policy "users can manage own cart"
on public.carts for all
using (auth.uid() = customer_id)
with check (auth.uid() = customer_id);

drop policy if exists "users can view own cart items" on public.cart_items;
create policy "users can view own cart items"
on public.cart_items for select
using (
  exists (
    select 1 from public.carts c
    where c.id = cart_items.cart_id
      and c.customer_id = auth.uid()
  )
);

drop policy if exists "users can create own cart items" on public.cart_items;
create policy "users can create own cart items"
on public.cart_items for insert
with check (
  exists (
    select 1 from public.carts c
    where c.id = cart_items.cart_id
      and c.customer_id = auth.uid()
  )
);

drop policy if exists "users can update own cart items" on public.cart_items;
create policy "users can update own cart items"
on public.cart_items for update
using (
  exists (
    select 1 from public.carts c
    where c.id = cart_items.cart_id
      and c.customer_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.carts c
    where c.id = cart_items.cart_id
      and c.customer_id = auth.uid()
  )
);

drop policy if exists "users can delete own cart items" on public.cart_items;
create policy "users can delete own cart items"
on public.cart_items for delete
using (
  exists (
    select 1 from public.carts c
    where c.id = cart_items.cart_id
      and c.customer_id = auth.uid()
  )
);

drop policy if exists "users can view own orders" on public.orders;
create policy "users can view own orders"
on public.orders for select
using (auth.uid() = customer_id);

drop policy if exists "users can create own orders" on public.orders;
create policy "users can create own orders"
on public.orders for insert
with check (auth.uid() = customer_id);

drop policy if exists "users can view own order items" on public.order_items;
create policy "users can view own order items"
on public.order_items for select
using (
  exists (
    select 1 from public.orders o
    where o.id = order_items.order_id
      and o.customer_id = auth.uid()
  )
);

drop policy if exists "users can create own order items" on public.order_items;
create policy "users can create own order items"
on public.order_items for insert
with check (
  exists (
    select 1 from public.orders o
    where o.id = order_items.order_id
      and o.customer_id = auth.uid()
  )
);

drop policy if exists "users can view own tasks" on public.tasks;
create policy "users can view own tasks"
on public.tasks for select
using (
  exists (
    select 1 from public.orders o
    where o.id = tasks.order_id
      and o.customer_id = auth.uid()
  )
);

drop policy if exists "users can create own tasks" on public.tasks;
create policy "users can create own tasks"
on public.tasks for insert
with check (
  exists (
    select 1 from public.orders o
    where o.id = tasks.order_id
      and o.customer_id = auth.uid()
  )
);

drop policy if exists "users can view own payments" on public.payments;
create policy "users can view own payments"
on public.payments for select
using (
  exists (
    select 1 from public.orders o
    where o.id = payments.order_id
      and o.customer_id = auth.uid()
  )
);

drop policy if exists "users can view own order status history" on public.order_status_history;
create policy "users can view own order status history"
on public.order_status_history for select
using (
  exists (
    select 1 from public.orders o
    where o.id = order_status_history.order_id
      and o.customer_id = auth.uid()
  )
);

-- Seller/partner shop and product management.
drop policy if exists "partners can view own shops" on public.shops;
create policy "partners can view own shops"
on public.shops for select
using (owner_id = auth.uid());

drop policy if exists "partners can create own shop" on public.shops;
create policy "partners can create own shop"
on public.shops for insert
with check (
  owner_id = auth.uid()
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'partner'
  )
);

drop policy if exists "partners can update own shop" on public.shops;
create policy "partners can update own shop"
on public.shops for update
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists "partners can view own products" on public.products;
create policy "partners can view own products"
on public.products for select
using (
  exists (
    select 1 from public.shops s
    where s.id = products.shop_id
      and s.owner_id = auth.uid()
  )
);

drop policy if exists "partners can create products in own shop" on public.products;
create policy "partners can create products in own shop"
on public.products for insert
with check (
  exists (
    select 1 from public.shops s
    join public.profiles p on p.id = auth.uid()
    where s.id = products.shop_id
      and s.owner_id = auth.uid()
      and p.role = 'partner'
  )
);

drop policy if exists "partners can update own products" on public.products;
create policy "partners can update own products"
on public.products for update
using (
  exists (
    select 1 from public.shops s
    where s.id = products.shop_id
      and s.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.shops s
    where s.id = products.shop_id
      and s.owner_id = auth.uid()
  )
);

drop policy if exists "partners can delete own products" on public.products;
create policy "partners can delete own products"
on public.products for delete
using (
  exists (
    select 1 from public.shops s
    where s.id = products.shop_id
      and s.owner_id = auth.uid()
  )
);

-- A signed-in user may edit their own contact details, but cannot change
-- their role through the browser client.
-- Keep the role immutable from the browser client.
-- A security-definer helper avoids recursive RLS evaluation on profiles.
create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $function$
  select case when lower(coalesce(u.email,'')) = 'innocentmaweta@gmail.com' then 'admin'::public.user_role else p.role end
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = auth.uid()
$function$;

revoke all on function public.current_user_role() from public;
grant execute on function public.current_user_role() to authenticated;

drop policy if exists "users can update own profile" on public.profiles;
create policy "users can update own profile"
on public.profiles for update
using (auth.uid() = id)
with check (
  auth.uid() = id
  and role = public.current_user_role()
);

-- Product photos are stored in a public bucket so marketplace images can be
-- displayed directly to customers. The bucket itself should be created once
-- in Supabase Storage before sellers upload photos.
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = true;

drop policy if exists "public can view product images" on storage.objects;
create policy "public can view product images"
on storage.objects for select
using (bucket_id = 'product-images');

drop policy if exists "partners can upload product images" on storage.objects;
create policy "partners can upload product images"
on storage.objects for insert
with check (
  bucket_id = 'product-images'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'partner'
  )
);

drop policy if exists "partners can update product images" on storage.objects;
create policy "partners can update product images"
on storage.objects for update
using (
  bucket_id = 'product-images'
  and owner_id = auth.uid()::text
)
with check (
  bucket_id = 'product-images'
  and owner_id = auth.uid()::text
);

drop policy if exists "partners can delete product images" on storage.objects;
create policy "partners can delete product images"
on storage.objects for delete
using (
  bucket_id = 'product-images'
  and owner_id = auth.uid()::text
);

-- Customer-facing data is intentionally read-only for shops/products/categories.
-- Payments, assignments, pricing rules and order status changes are controlled
-- by trusted backend/admin processes rather than the public client.

-- If this script has just created/changed tables, refresh PostgREST's schema cache.
notify pgrst, 'reload schema';
