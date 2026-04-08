begin;

-- Phase 9: menu item images.
-- Purpose:
-- 1. Add a persistent image_url field to menu_items.
-- 2. Provision a public Supabase storage bucket for menu item images.
-- 3. Keep the upload path simple for the admin edit flow.

alter table public.menu_items
  add column if not exists image_url text;

comment on column public.menu_items.image_url is
  'Public Supabase storage URL for the current menu item image.';

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'menu-item-images',
  'menu-item-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

commit;
