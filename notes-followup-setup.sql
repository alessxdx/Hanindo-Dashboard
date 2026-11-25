-- Follow-up dates on notes. Adds one empty column to the notes; nothing else
-- changes. Run once in the Supabase SQL editor.
alter table public.others add column if not exists follow_up date;
notify pgrst, 'reload schema';
