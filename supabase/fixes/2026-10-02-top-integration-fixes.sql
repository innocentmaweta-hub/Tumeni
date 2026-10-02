-- Tumeni top integration fixes
-- Run this once in Supabase SQL Editor against the live project.
-- These statements are intentionally idempotent.

-- 1. Keep order attachments private. The app already uses signed URLs.
insert into storage.buckets (id, name, public)
values ('order-attachments', 'order-attachments', false)
on conflict (id) do update set public = false;

-- 2. Make sure the tasks columns used by the current application exist.
alter table public.tasks
  add column if not exists assigned_employee_id uuid references public.profiles(id),
  add column if not exists deadline_at timestamptz,
  add column if not exists completion_note text,
  add column if not exists completed_at timestamptz;

create index if not exists tasks_assigned_employee_idx
  on public.tasks(assigned_employee_id);
create index if not exists tasks_deadline_idx
  on public.tasks(deadline_at);

-- 3. Keep the canonical task/customer relationship unambiguous:
-- tasks belongs to an order; the customer's id comes from orders.customer_id.
-- Do not add a duplicated tasks.customer_id column.

notify pgrst, 'reload schema';
