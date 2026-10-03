-- Exclusive Offer banner controls
-- Adds editable labels used by the homepage hero and Exclusive Offer card.

alter table public.promotional_banners
  add column if not exists eyebrow text;

alter table public.promotional_banners
  add column if not exists exclusive_label text;

update public.promotional_banners
set eyebrow = coalesce(nullif(trim(eyebrow), ''), 'LIMITED TIME'),
    exclusive_label = coalesce(nullif(trim(exclusive_label), ''), 'EXCLUSIVE OFFER');

notify pgrst, 'reload schema';
