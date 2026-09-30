-- Tumeni Phase 6.4B: admin-managed promotional banners
create table if not exists public.promotional_banners (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subtitle text,
  image_url text,
  button_text text not null default 'Shop Now',
  destination text not null default 'Explore',
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists promotional_banners_active_idx
  on public.promotional_banners(active, starts_at, ends_at, sort_order);
alter table public.promotional_banners enable row level security;
drop policy if exists "public can view active promotional banners" on public.promotional_banners;
create policy "public can view active promotional banners"
on public.promotional_banners for select to anon, authenticated
using (active=true and starts_at<=now() and (ends_at is null or ends_at>=now()));
drop policy if exists "admins can manage promotional banners" on public.promotional_banners;
create policy "admins can manage promotional banners"
on public.promotional_banners for all to authenticated
using (public.current_user_role()='admin')
with check (public.current_user_role()='admin');
grant select on public.promotional_banners to anon, authenticated;
grant insert, update, delete on public.promotional_banners to authenticated;
drop trigger if exists promotional_banners_updated_at on public.promotional_banners;
create trigger promotional_banners_updated_at before update on public.promotional_banners
for each row execute procedure public.set_updated_at();
notify pgrst, 'reload schema';
