-- Tumeni Phase 1 database
create extension if not exists pgcrypto;

create type public.user_role as enum ('customer','admin','partner','agent');
create type public.order_type as enum ('purchase','task');
create type public.order_status as enum ('pending_payment','paid','assigned','preparing','shopping','picked_up','on_the_way','delivered','cancelled','failed','refunded');

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  role public.user_role not null default 'customer',
  created_at timestamptz not null default now()
);

create table if not exists public.shops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  location text,
  contact_phone text,
  opening_hours jsonb,
  partnership_status text not null default 'active',
  created_at timestamptz not null default now()
);

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

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id),
  order_number text not null unique default ('TM-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))),
  order_type public.order_type not null,
  status public.order_status not null default 'pending_payment',
  subtotal numeric(12,2) not null default 0,
  service_fee numeric(12,2) not null default 0,
  delivery_fee numeric(12,2) not null default 0,
  handling_fee numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
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
  amount numeric(12,2) not null,
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

create index if not exists products_shop_id_idx on public.products(shop_id);
create index if not exists products_category_id_idx on public.products(category_id);
create index if not exists orders_customer_id_idx on public.orders(customer_id);
create index if not exists orders_status_idx on public.orders(status);
create index if not exists order_items_order_id_idx on public.order_items(order_id);
create index if not exists payments_order_id_idx on public.payments(order_id);

alter table public.profiles enable row level security;
alter table public.shops enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.addresses enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.tasks enable row level security;
alter table public.payments enable row level security;
alter table public.order_assignments enable row level security;
alter table public.pricing_rules enable row level security;

create policy "public can view active shops" on public.shops for select using (partnership_status = 'active');
create policy "public can view categories" on public.categories for select using (true);
create policy "public can view available products" on public.products for select using (available = true);

create policy "users can view own profile" on public.profiles for select using (auth.uid() = id);
create policy "users can update own profile" on public.profiles for update using (auth.uid() = id);
create policy "users can manage own addresses" on public.addresses for all using (auth.uid() = customer_id) with check (auth.uid() = customer_id);
create policy "users can view own orders" on public.orders for select using (auth.uid() = customer_id);
create policy "users can create own orders" on public.orders for insert with check (auth.uid() = customer_id);
create policy "users can view own order items" on public.order_items for select using (
  exists (select 1 from public.orders o where o.id = order_items.order_id and o.customer_id = auth.uid())
);
create policy "users can create own order items" on public.order_items for insert with check (
  exists (select 1 from public.orders o where o.id = order_items.order_id and o.customer_id = auth.uid())
);
create policy "users can view own tasks" on public.tasks for select using (
  exists (select 1 from public.orders o where o.id = tasks.order_id and o.customer_id = auth.uid())
);
create policy "users can create own tasks" on public.tasks for insert with check (
  exists (select 1 from public.orders o where o.id = tasks.order_id and o.customer_id = auth.uid())
);
create policy "users can view own payments" on public.payments for select using (
  exists (select 1 from public.orders o where o.id = payments.order_id and o.customer_id = auth.uid())
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();
