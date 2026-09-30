-- Tumeni Phase 6.8.3 — Abandoned cart engagement
create or replace function public.trigger_my_cart_engagement()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid:=auth.uid(); created_count int:=0;
begin
if uid is null then return jsonb_build_object('created',false,'reason','not_authenticated'); end if;
if not exists(select 1 from public.notifications where recipient_id=uid and notification_type='abandoned_cart' and created_at>=now()-interval '24 hours') then
 insert into public.notifications(recipient_id,notification_type,title,message,metadata) values(uid,'abandoned_cart','Your Tumeni cart is waiting','You still have items in your cart. Come back when you are ready to complete your order.',jsonb_build_object('source','customer_cart')); created_count:=1;
end if;
return jsonb_build_object('created',created_count>0,'count',created_count);end;$$;
revoke all on function public.trigger_my_cart_engagement() from public,anon;grant execute on function public.trigger_my_cart_engagement() to authenticated;notify pgrst,'reload schema';