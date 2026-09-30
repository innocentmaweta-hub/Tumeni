-- Tumeni Phase 6.6 Step 1: persistent notifications
-- Run this file in the Supabase SQL Editor when ready.
-- Safe to run more than once.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  notification_type text not null default 'system',
  title text not null,
  message text not null,
  order_id uuid references public.orders(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.notifications
  add column if not exists notification_type text not null default 'system';

alter table public.notifications
  add column if not exists message text;

alter table public.notifications
  add column if not exists order_id uuid references public.orders(id) on delete cascade;

alter table public.notifications
  add column if not exists task_id uuid references public.tasks(id) on delete cascade;

alter table public.notifications
  add column if not exists product_id uuid references public.products(id) on delete cascade;

alter table public.notifications
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.notifications
  add column if not exists read_at timestamptz;

alter table public.notifications
  add column if not exists created_at timestamptz not null default now();

create index if not exists notifications_recipient_created_idx
  on public.notifications(recipient_id, created_at desc);

create index if not exists notifications_recipient_unread_idx
  on public.notifications(recipient_id, read_at, created_at desc);

create index if not exists notifications_order_idx
  on public.notifications(order_id);

create index if not exists notifications_task_idx
  on public.notifications(task_id);

create index if not exists notifications_product_idx
  on public.notifications(product_id);

alter table public.notifications enable row level security;

drop policy if exists "Users can read own notifications" on public.notifications;
create policy "Users can read own notifications"
  on public.notifications
  for select
  to authenticated
  using (recipient_id = auth.uid());

drop policy if exists "Users can mark own notifications read" on public.notifications;
create policy "Users can mark own notifications read"
  on public.notifications
  for update
  to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- Notification creation will be performed by trusted application/server
-- logic in later Phase 6.6 steps. Customers must not be able to create
-- notifications for themselves or other users.
revoke insert, delete on public.notifications from anon, authenticated;

grant select, update on public.notifications to authenticated;

-- Enable Supabase Realtime for future live notification delivery.
do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
