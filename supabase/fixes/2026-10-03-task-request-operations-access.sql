-- Allow Tumeni admins and assigned internal agents to view task request details.
-- Customers retain access only to their own task rows.

alter table public.tasks enable row level security;

drop policy if exists "assigned agents can view task requests" on public.tasks;
create policy "assigned agents can view task requests"
on public.tasks
for select
to authenticated
using (
  exists (
    select 1
    from public.order_assignments oa
    where oa.order_id = tasks.order_id
      and oa.agent_id = auth.uid()
      and oa.cancelled_at is null
  )
  or public.current_user_role() = 'admin'
);

drop policy if exists "customers and operations can view task locations" on public.task_locations;
create policy "customers and operations can view task locations"
on public.task_locations
for select
to authenticated
using (
  exists (
    select 1
    from public.tasks t
    join public.orders o on o.id = t.order_id
    where t.id = task_locations.task_id
      and o.customer_id = auth.uid()
  )
  or public.current_user_role() = 'admin'
  or exists (
    select 1
    from public.tasks t
    join public.order_assignments oa on oa.order_id = t.order_id
    where t.id = task_locations.task_id
      and oa.agent_id = auth.uid()
      and oa.cancelled_at is null
  )
);

drop policy if exists "customers and operations can view task attachments" on public.task_attachments;
create policy "customers and operations can view task attachments"
on public.task_attachments
for select
to authenticated
using (
  exists (
    select 1
    from public.tasks t
    join public.orders o on o.id = t.order_id
    where t.id = task_attachments.task_id
      and o.customer_id = auth.uid()
  )
  or public.current_user_role() = 'admin'
  or exists (
    select 1
    from public.tasks t
    join public.order_assignments oa on oa.order_id = t.order_id
    where t.id = task_attachments.task_id
      and oa.agent_id = auth.uid()
      and oa.cancelled_at is null
  )
);

drop policy if exists "customers and operations can view task attachment files" on storage.objects;
create policy "customers and operations can view task attachment files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'task-attachments'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.current_user_role() = 'admin'
    or exists (
      select 1
      from public.task_attachments ta
      join public.tasks t on t.id = ta.task_id
      join public.order_assignments oa on oa.order_id = t.order_id
      where ta.storage_path = storage.objects.name
        and oa.agent_id = auth.uid()
        and oa.cancelled_at is null
    )
  )
);

notify pgrst, 'reload schema';
