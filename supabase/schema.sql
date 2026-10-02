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
      'picked_up','on_the_way','delivered','cancelled','failed','returned',
      'disputed','refund_requested','refunded'
    );
  end if;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  avatar_url text,
  role public.user_role not null default 'customer',
  created_at timestamptz not null default now()
);

-- Existing databases may have an older profiles table without role.
alter table public.profiles
  add column if not exists role public.user_role not null default 'customer';

alter table public.profiles
  add column if not exists avatar_url text;

create table if not exists public.shops (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id) on delete set null,
  name text not null,
  description text,
  location text,
  contact_phone text,
  image_url text,
  opening_hours jsonb,
  partnership_status text not null default 'active',
  created_at timestamptz not null default now()
);

alter table public.shops add column if not exists owner_id uuid references public.profiles(id) on delete set null;
alter table public.shops add column if not exists image_url text;

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  image_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid references public.shops(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  name text not null,
  description text,
  price numeric(12,2) not null check (price >= 0),
  image_url text,
  available boolean not null default true,
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  low_stock_threshold integer not null default 5 check (low_stock_threshold >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


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

-- Phase 5.4: seller inventory preparation. These fields will support stock quantity and low-stock warnings.
alter table public.products add column if not exists stock_quantity integer not null default 0;
alter table public.products add column if not exists low_stock_threshold integer not null default 5;
alter table public.products drop constraint if exists products_stock_quantity_check;
alter table public.products add constraint products_stock_quantity_check check (stock_quantity >= 0);
alter table public.products drop constraint if exists products_low_stock_threshold_check;
alter table public.products add constraint products_low_stock_threshold_check check (low_stock_threshold >= 0);

create index if not exists product_reviews_product_id_idx on public.product_reviews(product_id);
create index if not exists product_reviews_customer_id_idx on public.product_reviews(customer_id);

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
  assigned_employee_id uuid references public.profiles(id),
  deadline_at timestamptz,
  completion_note text,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.tasks add column if not exists assigned_employee_id uuid references public.profiles(id);
alter table public.tasks add column if not exists deadline_at timestamptz;
alter table public.tasks add column if not exists completion_note text;
alter table public.tasks add column if not exists completed_at timestamptz;
create index if not exists tasks_assigned_employee_idx on public.tasks(assigned_employee_id);
create index if not exists tasks_deadline_idx on public.tasks(deadline_at);

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
  completed_at timestamptz,
  cancelled_at timestamptz
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
create index if not exists order_assignments_active_idx on public.order_assignments(order_id,assigned_at desc) where completed_at is null and cancelled_at is null;
create index if not exists order_status_history_order_id_idx on public.order_status_history(order_id);

-- Keep customer tracking complete: every order gets an initial history event.
create or replace function public.record_order_status_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if tg_op = 'INSERT' then
    insert into public.order_status_history(order_id,status,note,changed_by)
    values (new.id,new.status,'Order created.',new.customer_id);
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.order_status_history(order_id,status,note,changed_by)
    values (new.id,new.status,'Order status updated.',auth.uid());
  end if;

  return new;
end;
$function$;

drop trigger if exists orders_status_history on public.orders;
create trigger orders_status_history
after insert or update of status on public.orders
for each row execute procedure public.record_order_status_history();

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

drop trigger if exists product_reviews_updated_at on public.product_reviews;
create trigger product_reviews_updated_at
before update on public.product_reviews
for each row execute procedure public.set_updated_at();

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
        phone = coalesce(excluded.phone, public.profiles.phone),
        role = excluded.role;
  return new;
end;
$function$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Ensure the designated administrator is corrected even if the account already existed.
update public.profiles p
set role = 'admin'
from auth.users u
where p.id = u.id
  and lower(coalesce(u.email,'')) = 'innocentmaweta@gmail.com';

-- Role helper must exist before admin RLS policies are created.
create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public, auth
as $function$
  select case
    when lower(coalesce(u.email,'')) = 'innocentmaweta@gmail.com' then 'admin'::public.user_role
    else p.role
  end
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = auth.uid()
$function$;

revoke all on function public.current_user_role() from public;
grant execute on function public.current_user_role() to authenticated;

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
alter table public.product_reviews enable row level security;

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

drop policy if exists "admins can view profiles" on public.profiles;
create policy "admins can view profiles"
on public.profiles for select
using (public.current_user_role() = 'admin');

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

-- Agents need read-only access to delivery addresses for orders assigned to them.
-- Without this policy, the nested addresses relation in the agent work queue
-- can be hidden by RLS even though the agent can see the order itself.
drop policy if exists "agents can view assigned delivery addresses" on public.addresses;
create policy "agents can view assigned delivery addresses"
on public.addresses for select
to authenticated
using (
  exists (
    select 1
    from public.orders o
    join public.order_assignments oa on oa.order_id = o.id
    where o.delivery_address_id = addresses.id
      and oa.agent_id = auth.uid()
      and oa.completed_at is null
       and oa.cancelled_at is null
      and oa.cancelled_at is null
  )
);

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

-- Product ratings/comments: anyone may read them; only signed-in users may create,
-- update, or delete their own review for a product.
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

drop policy if exists "admins can manage admin products" on public.products;
create policy "admins can manage admin products"
on public.products for all
using (
  public.current_user_role() = 'admin'
  and shop_id is null
)
with check (
  public.current_user_role() = 'admin'
  and shop_id is null
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


-- Internal delivery employees keep the existing role name: agent.
-- Agents cannot self-assign work. Admins assign orders through a trusted RPC.
-- Reconcile Auth users into profiles so admin user management never misses a
-- customer whose profile row was not created by the signup trigger.
create or replace function public.sync_auth_users_to_profiles()
returns integer
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  inserted_count integer := 0;
  u record;
  user_role text;
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'Administrator access required';
  end if;

  for u in select id, email, raw_user_meta_data from auth.users loop
    if not exists (select 1 from public.profiles p where p.id = u.id) then
      user_role := case
        when lower(coalesce(u.email,'')) = 'innocentmaweta@gmail.com' then 'admin'
        when u.raw_user_meta_data->>'account_type' = 'seller' then 'partner'
        else 'customer'
      end;
      insert into public.profiles (id, full_name, phone, role)
      values (
        u.id,
        coalesce(u.raw_user_meta_data->>'full_name', u.email),
        u.raw_user_meta_data->>'phone',
        user_role::public.user_role
      )
      on conflict (id) do nothing;
      inserted_count := inserted_count + 1;
    end if;
  end loop;
  return inserted_count;
end;
$function$;

revoke all on function public.sync_auth_users_to_profiles() from public;
grant execute on function public.sync_auth_users_to_profiles() to authenticated;

create or replace function public.set_user_as_agent(p_user_id uuid)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $function$
declare result public.profiles;
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'Administrator access required';
  end if;
  update public.profiles
    set role = 'agent'
    where id = p_user_id
      and role <> 'admin'
    returning * into result;
  if result.id is null then
    raise exception 'User could not be made an agent';
  end if;
  return result;
end;
$function$;

revoke all on function public.set_user_as_agent(uuid) from public;
grant execute on function public.set_user_as_agent(uuid) to authenticated;

create or replace function public.assign_order_to_agent(p_order_id uuid, p_agent_id uuid)
returns public.order_assignments
language plpgsql
security definer
set search_path = public
as $function$
declare
  result public.order_assignments;
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'Administrator access required';
  end if;
  if not exists (select 1 from public.profiles where id = p_agent_id and role = 'agent') then
    raise exception 'Selected user is not an agent';
  end if;
  if not exists (
    select 1
    from public.orders
    where id = p_order_id
      and status in ('paid','assigned')
  ) then
    raise exception 'Only paid or already-assigned orders can be assigned to an agent';
  end if;
  -- A reassignment must not mark the previous assignment as completed.
  -- Leave the previous row open in history and let the active assignment be
  -- selected by the application's latest-assignment logic.
  insert into public.order_assignments(order_id, agent_id)
  values (p_order_id, p_agent_id)
  returning * into result;
  update public.orders
    set status = 'assigned'
    where id = p_order_id
      and status in ('paid','assigned');
  insert into public.order_status_history(order_id,status,note,changed_by)
  values (p_order_id,'assigned','Order assigned to an internal agent.',auth.uid());
  return result;
end;
$function$;

revoke all on function public.assign_order_to_agent(uuid,uuid) from public;
grant execute on function public.assign_order_to_agent(uuid,uuid) to authenticated;

create or replace function public.agent_update_order_status(p_order_id uuid, p_status public.order_status, p_note text default '')
returns public.orders
language plpgsql
security definer
set search_path = public
as $function$
declare
  result public.orders;
  assignment public.order_assignments;
begin
  if public.current_user_role() <> 'agent' then
    raise exception 'Agent access required';
  end if;
  select * into assignment
  from public.order_assignments
  where order_id = p_order_id
    and agent_id = auth.uid()
    and completed_at is null
    and cancelled_at is null
  order by assigned_at desc
  limit 1;
  if assignment.id is null then
    raise exception 'This order is not assigned to you';
  end if;
  if p_status not in ('preparing','shopping','picked_up','on_the_way','delivered') then
    raise exception 'Invalid agent status';
  end if;
  update public.orders
  set status = p_status
  where id = p_order_id
    and status in ('assigned','preparing','shopping','picked_up','on_the_way')
  returning * into result;
  if result.id is null then
    raise exception 'Order cannot move from its current status to %', p_status;
  end if;
  update public.order_assignments
  set accepted_at = case when p_status = 'preparing' and accepted_at is null then now() else accepted_at end,
      completed_at = case when p_status = 'delivered' then now() else completed_at end
  where id = assignment.id;
  insert into public.order_status_history(order_id,status,note,changed_by)
  values (p_order_id,p_status,nullif(trim(coalesce(p_note,'')),''),auth.uid());
  return result;
end;
$function$;

revoke all on function public.agent_update_order_status(uuid,public.order_status,text) from public;
grant execute on function public.agent_update_order_status(uuid,public.order_status,text) to authenticated;

drop policy if exists "admins can view all orders" on public.orders;
create policy "admins can view all orders"
on public.orders for select
using (public.current_user_role() = 'admin');

drop policy if exists "admins can view all order items" on public.order_items;
create policy "admins can view all order items"
on public.order_items for select
using (public.current_user_role() = 'admin');

drop policy if exists "agents can view assigned orders" on public.orders;
create policy "agents can view assigned orders"
on public.orders for select
using (
  exists (
    select 1 from public.order_assignments oa
    where oa.order_id = orders.id
      and oa.agent_id = auth.uid()
      and oa.completed_at is null
  )
);

drop policy if exists "agents can view assigned order items" on public.order_items;
create policy "agents can view assigned order items"
on public.order_items for select
using (
  exists (
    select 1 from public.order_assignments oa
    where oa.order_id = order_items.order_id
      and oa.agent_id = auth.uid()
      and oa.completed_at is null
  )
);

drop policy if exists "admins can manage assignments" on public.order_assignments;
create policy "admins can manage assignments"
on public.order_assignments for all
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

drop policy if exists "agents can view own assignments" on public.order_assignments;
create policy "agents can view own assignments"
on public.order_assignments for select
using (agent_id = auth.uid());

drop policy if exists "admins can view all status history" on public.order_status_history;
create policy "admins can view all status history"
on public.order_status_history for select
using (public.current_user_role() = 'admin');

-- Customer-facing data is intentionally read-only for shops/products/categories.
-- Payments, assignments, pricing rules and order status changes are controlled
-- by trusted backend/admin processes rather than the public client.

-- If this script has just created/changed tables, refresh PostgREST's schema cache.
notify pgrst, 'reload schema';


-- Multiple product images. Keep products.image_url as the primary/legacy image for compatibility.
create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  image_url text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists product_images_product_id_sort_idx
  on public.product_images(product_id, sort_order, created_at);

alter table public.product_images enable row level security;

drop policy if exists "public can view product images records" on public.product_images;
create policy "public can view product images records"
on public.product_images for select
to anon, authenticated
using (true);

drop policy if exists "partners can create own product image records" on public.product_images;
create policy "partners can create own product image records"
on public.product_images for insert
to authenticated
with check (
  exists (
    select 1 from public.products pr
    join public.shops s on s.id = pr.shop_id
    where pr.id = product_images.product_id
      and s.owner_id = auth.uid()
  )
);

drop policy if exists "partners can update own product image records" on public.product_images;
create policy "partners can update own product image records"
on public.product_images for update
to authenticated
using (
  exists (
    select 1 from public.products pr
    join public.shops s on s.id = pr.shop_id
    where pr.id = product_images.product_id
      and s.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.products pr
    join public.shops s on s.id = pr.shop_id
    where pr.id = product_images.product_id
      and s.owner_id = auth.uid()
  )
);

drop policy if exists "partners can delete own product image records" on public.product_images;
create policy "partners can delete own product image records"
on public.product_images for delete
to authenticated
using (
  exists (
    select 1 from public.products pr
    join public.shops s on s.id = pr.shop_id
    where pr.id = product_images.product_id
      and s.owner_id = auth.uid()
  )
);

drop policy if exists "admins can manage admin product image records" on public.product_images;
create policy "admins can manage admin product image records"
on public.product_images for all
to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

grant select on table public.product_images to anon, authenticated;
grant insert, update, delete on table public.product_images to authenticated;

-- Allow the designated admin to upload product photos as well as partners.
drop policy if exists "partners can upload product images" on storage.objects;
create policy "partners can upload product images"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'partner')
    or public.current_user_role() = 'admin'
  )
);

notify pgrst, 'reload schema';


-- Phase 2: order conversations and customer attachments.
create table if not exists public.order_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  message text,
  attachment_url text,
  attachment_name text,
  created_at timestamptz not null default now(),
  constraint order_messages_has_content check (nullif(trim(coalesce(message,'')), '') is not null or attachment_url is not null)
);

create index if not exists order_messages_order_created_idx on public.order_messages(order_id, created_at);
alter table public.order_messages enable row level security;

drop policy if exists "customers can view own order messages" on public.order_messages;
create policy "customers can view own order messages"
on public.order_messages for select to authenticated
using (exists (select 1 from public.orders o where o.id = order_messages.order_id and o.customer_id = auth.uid()));

drop policy if exists "customers can send own order messages" on public.order_messages;
create policy "customers can send own order messages"
on public.order_messages for insert to authenticated
with check (
  sender_id = auth.uid()
  and exists (select 1 from public.orders o where o.id = order_messages.order_id and o.customer_id = auth.uid())
);

drop policy if exists "admins can manage order messages" on public.order_messages;
create policy "admins can manage order messages"
on public.order_messages for all to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

drop policy if exists "agents can view assigned order messages" on public.order_messages;
create policy "agents can view assigned order messages"
on public.order_messages for select to authenticated
using (exists (select 1 from public.order_assignments oa where oa.order_id = order_messages.order_id and oa.agent_id = auth.uid() and oa.completed_at is null and oa.cancelled_at is null));

drop policy if exists "agents can send assigned order messages" on public.order_messages;
create policy "agents can send assigned order messages"
on public.order_messages for insert to authenticated
with check (
  sender_id = auth.uid()
  and exists (select 1 from public.order_assignments oa where oa.order_id = order_messages.order_id and oa.agent_id = auth.uid() and oa.completed_at is null)
);

grant select, insert on table public.order_messages to authenticated;

insert into storage.buckets (id, name, public)
values ('order-attachments', 'order-attachments', false)
on conflict (id) do update set public = false;

drop policy if exists "users can view order attachments" on storage.objects;
create policy "users can view order attachments"
on storage.objects for select to authenticated
using (
  bucket_id = 'order-attachments'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.current_user_role() = 'admin'
    or exists (
      select 1 from public.order_assignments oa
      where oa.agent_id = auth.uid()
        and oa.completed_at is null
        and oa.order_id::text = (storage.foldername(name))[2]
    )
  )
);

drop policy if exists "users can upload order attachments" on storage.objects;
create policy "users can upload order attachments"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'order-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

notify pgrst, 'reload schema';


-- Phase 5.3: task/service marketplace preparation.
-- Task progress continues to use the order lifecycle until these task-specific
-- fields are activated in the live database.
-- Phase 5.2: advanced order lifecycle helpers.
create or replace function public.admin_update_order_status(
  p_order_id uuid,
  p_status public.order_status,
  p_note text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  current_status public.order_status;
  result_order public.orders;
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'Only admins can update order status';
  end if;

  select status into current_status from public.orders where id = p_order_id for update;
  if current_status is null then raise exception 'Order not found'; end if;

  if current_status = 'delivered' and p_status not in ('returned','disputed','refund_requested','refunded') then
    raise exception 'Delivered orders cannot move back into active processing';
  end if;
  if current_status in ('cancelled','refunded') and p_status not in ('disputed','refund_requested','refunded') then
    raise exception 'Closed orders cannot be reopened';
  end if;

  update public.orders set status = p_status where id = p_order_id returning * into result_order;
  insert into public.order_status_history(order_id,status,note,changed_by)
  values (p_order_id,p_status,nullif(trim(p_note),''),auth.uid());
  return result_order;
end;
$$;

create or replace function public.customer_cancel_order(p_order_id uuid, p_note text default null)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  current_status public.order_status;
  result_order public.orders;
begin
  select status into current_status from public.orders
  where id = p_order_id and customer_id = auth.uid()
  for update;
  if current_status is null then raise exception 'Order not found'; end if;

  if current_status not in ('pending_payment','paid','assigned') then
    raise exception 'This order can no longer be cancelled';
  end if;

  update public.orders set status = 'cancelled' where id = p_order_id returning * into result_order;
  insert into public.order_status_history(order_id,status,note,changed_by)
  values (p_order_id,'cancelled',coalesce(nullif(trim(p_note),''),'Cancelled by customer'),auth.uid());
  return result_order;
end;
$$;

grant execute on function public.admin_update_order_status(uuid,public.order_status,text) to authenticated;
grant execute on function public.customer_cancel_order(uuid,text) to authenticated;

-- Phase 4.1: promotions and discounts.
create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text,
  scope text not null default 'global' check (scope in ('global','product','shop')),
  product_id uuid references public.products(id) on delete cascade,
  shop_id uuid references public.shops(id) on delete cascade,
  discount_type text not null default 'percentage' check (discount_type in ('percentage','fixed')),
  discount_value numeric(12,2) not null check (discount_value > 0),
  min_order_amount numeric(12,2) not null default 0 check (min_order_amount >= 0),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint promotions_scope_target check (
    (scope='global' and product_id is null and shop_id is null)
    or (scope='product' and product_id is not null and shop_id is null)
    or (scope='shop' and shop_id is not null and product_id is null)
  )
);
create index if not exists promotions_active_idx on public.promotions(active, starts_at, ends_at);
create index if not exists promotions_product_idx on public.promotions(product_id);
create index if not exists promotions_shop_idx on public.promotions(shop_id);
create unique index if not exists promotions_code_unique_idx on public.promotions(lower(code)) where code is not null;
alter table public.promotions enable row level security;
drop policy if exists "public can view active promotions" on public.promotions;
create policy "public can view active promotions" on public.promotions for select to anon, authenticated using (active = true and starts_at <= now() and (ends_at is null or ends_at >= now()));
drop policy if exists "admins can manage promotions" on public.promotions;
create policy "admins can manage promotions" on public.promotions for all to authenticated using (public.current_user_role()='admin') with check (public.current_user_role()='admin');
grant select on public.promotions to anon, authenticated;
grant insert, update, delete on public.promotions to authenticated;
notify pgrst, 'reload schema';


-- Phase 6.2: customer behavioral tracking for personalized recommendations.
create table if not exists public.customer_behavior_events (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in (
    'product_view','product_click','search','favorite_add','favorite_remove','category_view','cart_add'
  )),
  product_id uuid references public.products(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  search_query text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists customer_behavior_events_customer_created_idx
  on public.customer_behavior_events(customer_id, created_at desc);
create index if not exists customer_behavior_events_product_created_idx
  on public.customer_behavior_events(product_id, created_at desc);
create index if not exists customer_behavior_events_type_created_idx
  on public.customer_behavior_events(event_type, created_at desc);

alter table public.customer_behavior_events enable row level security;

drop policy if exists "customers can create own behavior events" on public.customer_behavior_events;
create policy "customers can create own behavior events"
on public.customer_behavior_events for insert
to authenticated
with check (customer_id = auth.uid());

drop policy if exists "customers can view own behavior events" on public.customer_behavior_events;
create policy "customers can view own behavior events"
on public.customer_behavior_events for select
to authenticated
using (customer_id = auth.uid());

drop policy if exists "admins can view behavior events" on public.customer_behavior_events;
create policy "admins can view behavior events"
on public.customer_behavior_events for select
to authenticated
using (public.current_user_role() = 'admin');

grant select, insert on public.customer_behavior_events to authenticated;

notify pgrst, 'reload schema';


-- Phase 6.2B: personalized recommendation engine.
-- Keep this function in the canonical schema so fresh/updated databases
-- expose the RPC used by the application.
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
  where e.customer_id = auth.uid()
    and e.product_id is not null
    and e.created_at >= now() - interval '30 days'
  group by e.product_id
),
category_scores as (
  select p.category_id,
    sum((case e.event_type when 'favorite_add' then 6 when 'cart_add' then 5 when 'product_click' then 3 when 'product_view' then 1 else 0 end)
      * greatest(0.15, 1 - extract(epoch from (now() - e.created_at)) / 2592000.0)) as category_score
  from public.customer_behavior_events e
  join public.products p on p.id = e.product_id
  where e.customer_id = auth.uid()
    and p.category_id is not null
    and e.created_at >= now() - interval '30 days'
  group by p.category_id
),
shop_scores as (
  select p.shop_id,
    sum((case e.event_type when 'favorite_add' then 4 when 'cart_add' then 4 when 'product_click' then 2 when 'product_view' then 1 else 0 end)
      * greatest(0.15, 1 - extract(epoch from (now() - e.created_at)) / 2592000.0)) as shop_score
  from public.customer_behavior_events e
  join public.products p on p.id = e.product_id
  where e.customer_id = auth.uid()
    and p.shop_id is not null
    and e.created_at >= now() - interval '30 days'
  group by p.shop_id
),
popular as (
  select e.product_id,
    sum((case e.event_type when 'favorite_add' then 5 when 'cart_add' then 4 when 'product_click' then 2 when 'product_view' then 1 else 0 end)
      * greatest(0.15, 1 - extract(epoch from (now() - e.created_at)) / 2592000.0)) as popularity_score
  from public.customer_behavior_events e
  where e.product_id is not null
    and e.created_at >= now() - interval '30 days'
  group by e.product_id
),
purchased as (
  select distinct oi.product_id
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where o.customer_id = auth.uid()
    and oi.product_id is not null
    and o.status not in ('cancelled','refunded')
),
scored as (
  select p.id,p.name,p.description,p.price,p.image_url,p.shop_id,
    coalesce(s.name,'Admin Product') as shop,
    p.category_id,
    coalesce(c.name,'Other') as category,
    round((coalesce(es.direct_score,0)
      + coalesce(cs.category_score,0) * 0.65
      + coalesce(ss.shop_score,0) * 0.35
      + coalesce(pop.popularity_score,0) * 0.25)::numeric,3) as recommendation_score,
    case
      when coalesce(es.direct_score,0) > 0 then 'Based on your recent activity'
      when coalesce(cs.category_score,0) > 0 then 'Based on categories you explore'
      when coalesce(ss.shop_score,0) > 0 then 'Based on shops you interact with'
      else 'Popular on Tumeni'
    end as recommendation_reason
  from public.products p
  left join public.shops s on s.id = p.shop_id
  left join public.categories c on c.id = p.category_id
  left join event_scores es on es.product_id = p.id
  left join category_scores cs on cs.category_id = p.category_id
  left join shop_scores ss on ss.shop_id = p.shop_id
  left join popular pop on pop.product_id = p.id
  where p.available = true
    and p.stock_quantity > 0
    and not exists (select 1 from purchased x where x.product_id = p.id)
)
select *
from scored
order by recommendation_score desc, name asc
limit greatest(1, least(coalesce(p_limit,8),24));
$function$;

revoke all on function public.get_personalized_recommendations(integer) from public;
grant execute on function public.get_personalized_recommendations(integer) to authenticated;

notify pgrst, 'reload schema';


-- Storage bucket for customer profile photos.
insert into storage.buckets (id,name,public)
values ('profile-images','profile-images',true)
on conflict (id) do update set public=true;

drop policy if exists "users can upload own profile photos" on storage.objects;
create policy "users can upload own profile photos"
on storage.objects for insert to authenticated
with check (bucket_id = 'profile-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users can update own profile photos" on storage.objects;
create policy "users can update own profile photos"
on storage.objects for update to authenticated
using (bucket_id = 'profile-images' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'profile-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users can delete own profile photos" on storage.objects;
create policy "users can delete own profile photos"
on storage.objects for delete to authenticated
using (bucket_id = 'profile-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "public can view profile photos" on storage.objects;
create policy "public can view profile photos"
on storage.objects for select to public
using (bucket_id = 'profile-images');


-- Category and seller shop images.
insert into storage.buckets (id,name,public)
values ('category-images','category-images',true)
on conflict (id) do update set public=true;

drop policy if exists "admins can upload category images" on storage.objects;
create policy "admins can upload category images"
on storage.objects for insert to authenticated
with check (bucket_id='category-images' and public.current_user_role()='admin');

drop policy if exists "admins can update category images" on storage.objects;
create policy "admins can update category images"
on storage.objects for update to authenticated
using (bucket_id='category-images' and public.current_user_role()='admin')
with check (bucket_id='category-images' and public.current_user_role()='admin');

drop policy if exists "admins can delete category images" on storage.objects;
create policy "admins can delete category images"
on storage.objects for delete to authenticated
using (bucket_id='category-images' and public.current_user_role()='admin');

drop policy if exists "public can view category images" on storage.objects;
create policy "public can view category images"
on storage.objects for select to public
using (bucket_id='category-images');

insert into storage.buckets (id,name,public)
values ('shop-images','shop-images',true)
on conflict (id) do update set public=true;

drop policy if exists "sellers can upload own shop images" on storage.objects;
create policy "sellers can upload own shop images"
on storage.objects for insert to authenticated
with check (
  bucket_id='shop-images'
  and (
    (storage.foldername(name))[1]=auth.uid()::text
    or public.current_user_role()='admin'
  )
);

drop policy if exists "sellers can update own shop images" on storage.objects;
create policy "sellers can update own shop images"
on storage.objects for update to authenticated
using (
  bucket_id='shop-images'
  and (
    (storage.foldername(name))[1]=auth.uid()::text
    or public.current_user_role()='admin'
  )
)
with check (
  bucket_id='shop-images'
  and (
    (storage.foldername(name))[1]=auth.uid()::text
    or public.current_user_role()='admin'
  )
);

drop policy if exists "sellers can delete own shop images" on storage.objects;
create policy "sellers can delete own shop images"
on storage.objects for delete to authenticated
using (
  bucket_id='shop-images'
  and (
    (storage.foldername(name))[1]=auth.uid()::text
    or public.current_user_role()='admin'
  )
);

drop policy if exists "public can view shop images" on storage.objects;
create policy "public can view shop images"
on storage.objects for select to public
using (bucket_id='shop-images');

notify pgrst, 'reload schema';
