-- Lock the dashboard's data to signed-in people only (run 2026-11-12).
-- Preconditions: an account exists and signing in works, and
-- "Allow new users to sign up" is OFF (Authentication → Sign In / Providers),
-- otherwise anyone could create an account with the public key.
-- The site release that sets SB_AUTH_REQUIRED = true (js/auth.js) goes out
-- right after this runs. Emergency undo at the bottom.

do $$
declare t text; pol record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;
    execute format('create policy signed_in_all on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- PDF uploads: only signed-in people may upload, replace or delete.
-- (Reading stays public for now: the bucket is public, so existing PDF links
-- keep working. Making the files private is a separate step.)
drop policy if exists documents_insert on storage.objects;
drop policy if exists documents_update on storage.objects;
drop policy if exists documents_delete on storage.objects;
create policy documents_insert on storage.objects for insert to authenticated with check (bucket_id = 'documents');
create policy documents_update on storage.objects for update to authenticated using (bucket_id = 'documents');
create policy documents_delete on storage.objects for delete to authenticated using (bucket_id = 'documents');

select tablename, policyname, roles from pg_policies where schemaname = 'public' order by tablename;

-- Step 2 (run 2026-11-12, after the site learned to fetch files with the sign-in):
-- PDFs private. update storage.buckets set public = false where id = 'documents';
-- drop policy if exists documents_select on storage.objects;
-- create policy documents_select on storage.objects for select to authenticated using (bucket_id = 'documents');

-- ===== EMERGENCY UNDO (opens every table to the public key again) =====
-- do $$ declare t text; begin
--   for t in select tablename from pg_tables where schemaname = 'public' loop
--     execute format('create policy open_all on public.%I for all to anon using (true) with check (true)', t);
--   end loop; end $$;
