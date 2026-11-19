-- Expenses tab on the Notes page: office running costs and money in/out per
-- department (Fire fighting office, POSIVA, ...). Run once in the Supabase
-- SQL editor. Signed-in users only, like every other table (lockdown.sql).
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  department text not null,          -- e.g. 'Fire fighting office', 'POSIVA'
  entry_date date,                   -- for sorting; a month-only date uses the 1st
  period text,                       -- shown instead of the date when set: 'Jan–Oct 2026', 'Dec 2025'
  description text not null,
  category text,
  amount numeric not null,
  currency text default 'IDR',
  kind text default 'spent',         -- 'spent' or 'received'
  paid_by text,                      -- company the payment went through
  note text,
  attachments jsonb default '[]'::jsonb
);
alter table public.expenses enable row level security;
drop policy if exists signed_in_all on public.expenses;
create policy signed_in_all on public.expenses for all to authenticated using (true) with check (true);
