-- Tumeni order tracking history
-- Run once in Supabase SQL Editor.
-- Safe to run more than once.

create or replace function public.record_order_status_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if tg_op = 'INSERT' then
    insert into public.order_status_history(order_id,status,note,changed_by)
    values (new.id,new.status,'Order created.',new.customer_id);
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.order_status_history(order_id,status,note,changed_by)
    values (new.id,new.status,'Order status updated.',auth.uid());
  end if;

  return new;
end;
$function$;

drop trigger if exists orders_status_history on public.orders;
create trigger orders_status_history
after insert or update of status on public.orders
for each row execute procedure public.record_order_status_history();

-- Backfill orders created before the trigger existed.
insert into public.order_status_history(order_id,status,note,changed_by)
select o.id,o.status,'Order history backfilled.',o.customer_id
from public.orders o
where not exists (
  select 1
  from public.order_status_history h
  where h.order_id = o.id
);

notify pgrst, 'reload schema';
