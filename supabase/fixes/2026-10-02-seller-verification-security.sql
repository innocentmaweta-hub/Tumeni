-- Secure seller verification/suspension controls in the live database.
-- Safe to run more than once.

drop policy if exists "admins can manage shops" on public.shops;
create policy "admins can manage shops"
on public.shops for update
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

create or replace function public.prevent_partner_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if public.current_user_role() <> 'admin'
     and new.partnership_status is distinct from old.partnership_status then
    raise exception 'Only administrators can change seller verification status';
  end if;
  return new;
end;
$function$;

drop trigger if exists shops_protect_partnership_status on public.shops;
create trigger shops_protect_partnership_status
before update on public.shops
for each row execute function public.prevent_partner_status_change();

notify pgrst, 'reload schema';
