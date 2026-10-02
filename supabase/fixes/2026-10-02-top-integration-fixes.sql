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


-- Active agent assignment fix: reassignment cancels the old assignment
-- instead of marking it completed, so only the current agent remains active.
alter table public.order_assignments
  add column if not exists cancelled_at timestamptz;

create index if not exists order_assignments_active_idx
  on public.order_assignments(order_id, assigned_at desc)
  where completed_at is null and cancelled_at is null;

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
  if not exists (select 1 from public.orders where id = p_order_id and status in ('paid','assigned')) then
    raise exception 'Only paid or already-assigned orders can be assigned to an agent';
  end if;

  update public.order_assignments
  set cancelled_at = now()
  where order_id = p_order_id
    and completed_at is null
    and cancelled_at is null;

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

notify pgrst, 'reload schema';
