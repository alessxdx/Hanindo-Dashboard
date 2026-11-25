-- Categories on the Notes page ("CUSTOM visits", "POSIVA updates", ...).
-- Adds one empty column to the notes; nothing else changes. Run once in the
-- Supabase SQL editor.
alter table public.others add column if not exists category text;
notify pgrst, 'reload schema';
