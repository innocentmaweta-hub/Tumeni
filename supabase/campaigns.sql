-- Tumeni Phase 6.4A: marketing campaigns
-- Run this once in Supabase SQL Editor on the Tumeni project.

create table if not exists public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  discount_type text not null default 'percentage'
    check (discount_type in ('percentage','fixed')),
  discount_value numeric(12,2) not null default 0
    check (discount_value >= 0),
  product_ids uuid[] not null default '{}'::uuid[],
  category_ids uuid[] not null default '{}'::uuid[],
  customer_segment text not null default 'all'
    check (customer_segment in ('all','new','returning','high_frequency','inactive')),
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketing_campaigns_active_idx
  on public.marketing_campaigns(active, starts_at, ends_at);

create index if not exists marketing_campaigns_created_by_idx
  on public.marketing_campaigns(created_by);

alter table public.marketing_campaigns enable row level security;

drop policy if exists "public can view active marketing campaigns" on public.marketing_campaigns;
create policy "public can view active marketing campaigns"
on public.marketing_campaigns for select
to anon, authenticated
using (
  active = true
  and starts_at <= now()
  and (ends_at is null or ends_at >= now())
);

drop policy if exists "admins can manage marketing campaigns" on public.marketing_campaigns;
create policy "admins can manage marketing campaigns"
on public.marketing_campaigns for all
to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

grant select on public.marketing_campaigns to anon, authenticated;
grant insert, update, delete on public.marketing_campaigns to authenticated;

drop trigger if exists marketing_campaigns_updated_at on public.marketing_campaigns;
create trigger marketing_campaigns_updated_at
before update on public.marketing_campaigns
for each row execute procedure public.set_updated_at();

-- Connect an existing promotion to a campaign without changing current
-- promotion behaviour. Pricing/discount application remains in promotions.
alter table public.promotions
  add column if not exists campaign_id uuid references public.marketing_campaigns(id) on delete set null;

create index if not exists promotions_campaign_idx
  on public.promotions(campaign_id);

notify pgrst, 'reload schema';
