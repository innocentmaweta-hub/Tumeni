-- Tumeni Phase 6.6 Step 2: automatic notification generation
-- Run after supabase/notifications.sql in Supabase SQL Editor.

create or replace function public.create_tumeni_notification(
  p_recipient_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_order_id uuid default null,
  p_task_id uuid default null,
  p_product_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  notification_id uuid;
begin
  if p_recipient_id is null then
    return null;
  end if;

  insert into public.notifications
    (recipient_id, notification_type, title, message, order_id, task_id, product_id, metadata)
  values
    (p_recipient_id, coalesce(p_type,'system'), p_title, p_message,
     p_order_id, p_task_id, p_product_id, coalesce(p_metadata,'{}'::jsonb))
  returning id into notification_id;

  return notification_id;
end;
$$;

revoke all on function public.create_tumeni_notification(uuid,text,text,text,uuid,uuid,uuid,jsonb) from public, anon, authenticated;

create or replace function public.notify_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  status_title text;
  status_message text;
begin
  if tg_op = 'INSERT' then
    status_title := 'Order received';
    status_message := 'Your Tumeni order ' || coalesce(new.order_number,'') || ' has been received.';
    perform public.create_tumeni_notification(
      new.customer_id, 'order', status_title, status_message, new.id, null, null,
      jsonb_build_object('status', new.status)
    );
    return new;
  end if;

  if new.status is distinct from old.status then
    status_title := case new.status::text
      when 'pending_payment' then 'Payment required'
      when 'paid' then 'Payment confirmed'
      when 'assigned' then 'Order assigned'
      when 'preparing' then 'Order being prepared'
      when 'shopping' then 'Order at pickup'
      when 'picked_up' then 'Order picked up'
      when 'on_the_way' then 'Order is on the way'
      when 'delivered' then 'Order delivered'
      when 'cancelled' then 'Order cancelled'
      when 'failed' then 'Payment failed'
      when 'returned' then 'Order returned'
      when 'disputed' then 'Order under review'
      when 'refund_requested' then 'Refund requested'
      when 'refunded' then 'Refund completed'
      else 'Order update'
    end;

    status_message := case new.status::text
      when 'pending_payment' then 'Your order ' || coalesce(new.order_number,'') || ' is waiting for payment.'
      when 'paid' then 'Payment for order ' || coalesce(new.order_number,'') || ' has been confirmed.'
      when 'assigned' then 'Your order ' || coalesce(new.order_number,'') || ' has been assigned for fulfillment.'
      when 'preparing' then 'Your order ' || coalesce(new.order_number,'') || ' is being prepared.'
      when 'shopping' then 'Your order ' || coalesce(new.order_number,'') || ' is being collected.'
      when 'picked_up' then 'Your order ' || coalesce(new.order_number,'') || ' has been picked up.'
      when 'on_the_way' then 'Your order ' || coalesce(new.order_number,'') || ' is on the way.'
      when 'delivered' then 'Your order ' || coalesce(new.order_number,'') || ' has been delivered.'
      when 'cancelled' then 'Your order ' || coalesce(new.order_number,'') || ' has been cancelled.'
      when 'failed' then 'Payment for order ' || coalesce(new.order_number,'') || ' was not successful.'
      when 'returned' then 'Your order ' || coalesce(new.order_number,'') || ' has been returned.'
      when 'disputed' then 'Your order ' || coalesce(new.order_number,'') || ' is under review.'
      when 'refund_requested' then 'A refund has been requested for order ' || coalesce(new.order_number,'') || '.'
      when 'refunded' then 'A refund for order ' || coalesce(new.order_number,'') || ' has been completed.'
      else 'Your order ' || coalesce(new.order_number,'') || ' has been updated.'
    end;

    perform public.create_tumeni_notification(
      new.customer_id, 'order', status_title, status_message, new.id, null, null,
      jsonb_build_object('status', new.status, 'previous_status', old.status)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists orders_notification_trigger on public.orders;
create trigger orders_notification_trigger
after insert or update of status on public.orders
for each row execute function public.notify_order_status_change();

create or replace function public.notify_order_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  order_number text;
begin
  if new.agent_id is null then
    return new;
  end if;

  select o.order_number into order_number
  from public.orders o
  where o.id = new.order_id;

  perform public.create_tumeni_notification(
    new.agent_id,
    'assignment',
    'New delivery assigned',
    'Order ' || coalesce(order_number,'') || ' has been assigned to you.',
    new.order_id,
    null,
    null,
    jsonb_build_object('assignment_id', new.id)
  );

  return new;
end;
$$;

drop trigger if exists order_assignment_notification_trigger on public.order_assignments;
create trigger order_assignment_notification_trigger
after insert or update of agent_id on public.order_assignments
for each row execute function public.notify_order_assignment();

create or replace function public.notify_task_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $
begin
  if new.assigned_employee_id is null or
     (tg_op = 'UPDATE' and new.assigned_employee_id is not distinct from old.assigned_employee_id) then
    return new;
  end if;

  perform public.create_tumeni_notification(
    new.assigned_employee_id,
    'task',
    'New task assigned',
    'A Tumeni task has been assigned to you.',
    null,
    new.id,
    null,
    jsonb_build_object('task_id', new.id)
  );

  return new;
end;
$;

drop trigger if exists task_assignment_notification_trigger on public.tasks;
create trigger task_assignment_notification_trigger
after insert or update of assigned_employee_id on public.tasks
for each row execute function public.notify_task_assignment();

grant execute on function public.create_tumeni_notification(uuid,text,text,text,uuid,uuid,uuid,jsonb) to service_role;
