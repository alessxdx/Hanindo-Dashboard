-- Files on notes (e.g. a PDF report). Adds one empty column to the notes;
-- nothing else changes. Run once in the Supabase SQL editor.
alter table public.others add column if not exists attachments jsonb;
notify pgrst, 'reload schema';
