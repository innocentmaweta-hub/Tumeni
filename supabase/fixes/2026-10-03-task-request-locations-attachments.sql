-- Tumeni task locations and customer task attachments
-- Run once in Supabase SQL Editor before using the new task request media/map persistence.

create table if not exists public.task_locations (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  sequence integer not null default 1 check (sequence > 0),
  location_type text not null check (location_type in ('collect','deliver')),
  address text,
  latitude double precision not null,
  longitude double precision not null,
  created_at timestamptz not null default now()
);
create index if not exists task_locations_task_sequence_idx
  on public.task_locations(task_id, sequence);
alter table public.task_locations enable row level security;

drop policy if exists "customers can manage own task locations" on public.task_locations;
create policy "customers can manage own task locations"
on public.task_locations for all to authenticated
using (exists (
  select 1 from public.tasks t join public.orders o on o.id=t.order_id
  where t.id=task_locations.task_id and o.customer_id=auth.uid()
) or public.current_user_role()='admin')
with check (exists (
  select 1 from public.tasks t join public.orders o on o.id=t.order_id
  where t.id=task_locations.task_id and o.customer_id=auth.uid()
) or public.current_user_role()='admin');

grant select, insert, update, delete on public.task_locations to authenticated;

create table if not exists public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  attachment_type text not null check (attachment_type in ('image','voice')),
  storage_path text not null,
  file_name text,
  mime_type text,
  file_size bigint not null default 0 check (file_size >= 0),
  sequence integer not null default 1 check (sequence > 0),
  created_at timestamptz not null default now()
);
create index if not exists task_attachments_task_sequence_idx
  on public.task_attachments(task_id, sequence);
alter table public.task_attachments enable row level security;

drop policy if exists "customers can manage own task attachments" on public.task_attachments;
create policy "customers can manage own task attachments"
on public.task_attachments for all to authenticated
using (exists (
  select 1 from public.tasks t join public.orders o on o.id=t.order_id
  where t.id=task_attachments.task_id and o.customer_id=auth.uid()
) or public.current_user_role()='admin')
with check (exists (
  select 1 from public.tasks t join public.orders o on o.id=t.order_id
  where t.id=task_attachments.task_id and o.customer_id=auth.uid()
) or public.current_user_role()='admin');

grant select, insert, update, delete on public.task_attachments to authenticated;

insert into storage.buckets (id,name,public)
values ('task-attachments','task-attachments',false)
on conflict (id) do update set public=false;

drop policy if exists "customers can upload own task attachments" on storage.objects;
create policy "customers can upload own task attachments"
on storage.objects for insert to authenticated
with check (
  bucket_id='task-attachments'
  and (storage.foldername(name))[1]=auth.uid()::text
);

drop policy if exists "customers can view own task attachments" on storage.objects;
create policy "customers can view own task attachments"
on storage.objects for select to authenticated
using (
  bucket_id='task-attachments'
  and (
    (storage.foldername(name))[1]=auth.uid()::text
    or public.current_user_role()='admin'
  )
);

drop policy if exists "customers can delete own task attachments" on storage.objects;
create policy "customers can delete own task attachments"
on storage.objects for delete to authenticated
using (
  bucket_id='task-attachments'
  and (
    (storage.foldername(name))[1]=auth.uid()::text
    or public.current_user_role()='admin'
  )
);

notify pgrst,'reload schema';
