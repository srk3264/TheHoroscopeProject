alter table public.profiles
  add column if not exists relationship_type text,
  add column if not exists distance text,
  add column if not exists budget_preference text,
  add column if not exists city text,
  add column if not exists postal_code text;
