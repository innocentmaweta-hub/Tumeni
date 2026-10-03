-- Tumeni full audit fixes — 2026-10-03
-- Run this once in the Supabase SQL Editor before merging this branch.
-- Safe to re-run.

create table if not exists public.trust_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('product','shop','seller','customer','order','agent')),
  target_id uuid not null,
  product_id uuid references public.products(id) on delete set null,
  shop_id uuid references public.shops(id) on delete set null,
  reason text not null,
  details text,
  status text not null default 'open' check (status in ('open','reviewing','resolved','dismissed')),
  resolution_note text,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists trust_reports_status_created_idx on public.trust_reports(status,created_at desc);
create index if not exists trust_reports_target_idx on public.trust_reports(target_type,target_id);
create index if not exists trust_reports_reporter_idx on public.trust_reports(reporter_id);
alter table public.trust_reports enable row level security;
drop policy if exists "customers can create own trust reports" on public.trust_reports;
create policy "customers can create own trust reports" on public.trust_reports for insert to authenticated with check (reporter_id=auth.uid());
drop policy if exists "customers can view own trust reports" on public.trust_reports;
create policy "customers can view own trust reports" on public.trust_reports for select to authenticated using (reporter_id=auth.uid() or public.current_user_role()='admin');
drop policy if exists "admins can manage trust reports" on public.trust_reports;
create policy "admins can manage trust reports" on public.trust_reports for all to authenticated using (public.current_user_role()='admin') with check (public.current_user_role()='admin');
grant select,insert,update,delete on public.trust_reports to authenticated;
drop trigger if exists trust_reports_updated_at on public.trust_reports;
create trigger trust_reports_updated_at before update on public.trust_reports for each row execute procedure public.set_updated_at();

create table if not exists public.customer_behavior_events (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in ('product_view','product_click','search','favorite_add','favorite_remove','category_view','cart_add')),
  product_id uuid references public.products(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  search_query text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists customer_behavior_events_customer_created_idx on public.customer_behavior_events(customer_id,created_at desc);
create index if not exists customer_behavior_events_product_created_idx on public.customer_behavior_events(product_id,created_at desc);
create index if not exists customer_behavior_events_type_created_idx on public.customer_behavior_events(event_type,created_at desc);
alter table public.customer_behavior_events enable row level security;
drop policy if exists "customers can create own behavior events" on public.customer_behavior_events;
create policy "customers can create own behavior events" on public.customer_behavior_events for insert to authenticated with check (customer_id=auth.uid());
drop policy if exists "customers can read own behavior events" on public.customer_behavior_events;
create policy "customers can read own behavior events" on public.customer_behavior_events for select to authenticated using (customer_id=auth.uid() or public.current_user_role()='admin');
drop policy if exists "admins can manage behavior events" on public.customer_behavior_events;
create policy "admins can manage behavior events" on public.customer_behavior_events for all to authenticated using (public.current_user_role()='admin') with check (public.current_user_role()='admin');
grant select,insert,update,delete on public.customer_behavior_events to authenticated;

create table if not exists public.task_pricing_rules (
  id integer primary key,
  service_fee numeric(12,2) not null default 3000 check (service_fee>=0),
  handling_fee numeric(12,2) not null default 1000 check (handling_fee>=0),
  delivery_fee numeric(12,2) not null default 1000 check (delivery_fee>=0),
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.task_pricing_rules(id,service_fee,handling_fee,delivery_fee,active) values(1,3000,1000,1000,true) on conflict(id) do nothing;
alter table public.task_pricing_rules enable row level security;
drop policy if exists "authenticated can read active task pricing" on public.task_pricing_rules;
create policy "authenticated can read active task pricing" on public.task_pricing_rules for select to authenticated using (active=true or public.current_user_role()='admin');
drop policy if exists "admins can manage task pricing" on public.task_pricing_rules;
create policy "admins can manage task pricing" on public.task_pricing_rules for all to authenticated using (public.current_user_role()='admin') with check (public.current_user_role()='admin');
grant select,insert,update,delete on public.task_pricing_rules to authenticated;

create or replace function public.quote_task_request(p_request text)
returns jsonb language sql stable security invoker set search_path=''
as $$
  with r as (select greatest(1,length(trim(coalesce(p_request,'')))) as request_length),
  rule as (select service_fee,handling_fee,delivery_fee from public.task_pricing_rules where active=true order by id limit 1)
  select jsonb_build_object(
    'service_fee',coalesce(rule.service_fee,3000),
    'handling_fee',coalesce(rule.handling_fee,1000),
    'delivery_fee',coalesce(rule.delivery_fee,1000),
    'total',coalesce(rule.service_fee,3000)+coalesce(rule.handling_fee,1000)+coalesce(rule.delivery_fee,1000),
    'currency','MWK','request_length',r.request_length)
  from r cross join rule;
$$;
revoke all on function public.quote_task_request(text) from public,anon;
grant execute on function public.quote_task_request(text) to authenticated;

alter table public.promotional_banners add column if not exists is_exclusive_offer boolean not null default false;
create unique index if not exists promotional_banners_one_exclusive_idx on public.promotional_banners(is_exclusive_offer) where is_exclusive_offer=true;

create index if not exists orders_status_created_idx on public.orders(status,created_at);
create index if not exists order_assignments_active_idx on public.order_assignments(completed_at,assigned_at);
create index if not exists tasks_active_deadline_idx on public.tasks(completed_at,deadline_at,created_at);

notify pgrst,'reload schema';
