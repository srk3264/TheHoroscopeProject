alter table public.profiles
  add column if not exists relationship_type text,
  add column if not exists distance text;
