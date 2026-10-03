-- Add an optional due date/time to task requests.
-- timestamptz stores the exact instant and lets clients display it in the user's local timezone.

alter table public.tasks
  add column if not exists due_at timestamptz;

create index if not exists tasks_due_at_idx
on public.tasks(due_at)
where due_at is not null;

notify pgrst, 'reload schema';
