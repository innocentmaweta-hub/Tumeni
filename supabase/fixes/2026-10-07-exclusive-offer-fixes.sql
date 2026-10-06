-- Tumeni: allow multiple Exclusive Offer rows and keep multi-image slideshow data intact.
-- Safe to run more than once.
drop index if exists public.promotional_banners_one_exclusive_idx;
