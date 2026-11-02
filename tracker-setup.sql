-- One-time setup for the Project Tracker tab.
-- Run in the Supabase SQL editor (project mtuteycxdhlqpdupqolb).
-- Matches the app's convention: RLS enabled with allow-all policies,
-- so the public anon key can read/write. File attachments go to the
-- existing "documents" storage bucket under tracker/ (its policies
-- already cover any path in the bucket).

create table if not exists tracker_projects (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  customer text,
  country text,
  office text,                          -- Singapore | Indonesia | China
  status text not null default 'Enquiry', -- Enquiry|Quoted|Negotiation|Won|Lost|On hold
                                        -- plus 'Other' (2026-09-25): not-customer-related
                                        -- projects; fixed status outside the pipeline,
                                        -- no schema change needed (status is free text)
  est_value numeric,
  currency text default 'USD',
  expected_date date,
  contact_name text,
  contact_info text,
  notes text,
  products jsonb                        -- ["TK180 Plastic", ...] products of interest
);

-- Added 2026-09-15 after the initial setup ran; harmless to re-run.
alter table tracker_projects add column if not exists products jsonb;
alter table tracker_projects add column if not exists contact_position text;

-- Added 2026-09-21 (already run in production): payment progress for
-- Won projects — Not paid | Partially paid | Fully paid.
alter table tracker_projects add column if not exists payment text;

-- Added 2026-09-21 (already run in production): expected close as a
-- period ("2026-Q3" or "2026-12"); expected_date holds the period's
-- last day for overdue checks.
alter table tracker_projects add column if not exists expected_period text;

-- Added 2026-09-25: solution/product-type tag on projects
-- (Custom | Posiva | Fire fighting | any free text).
alter table tracker_projects add column if not exists solution text;


create table if not exists tracker_entries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  project_id uuid not null references tracker_projects(id) on delete cascade,
  entry_date date,
  entry_type text default 'Note',       -- Meeting|Quotation|Call|Email|WhatsApp|Site visit|Note
  title text,
  details text,
  attachments jsonb                     -- [{name,url}]
);

alter table tracker_projects enable row level security;
alter table tracker_entries enable row level security;
create policy "tracker_projects_all" on tracker_projects for all using (true) with check (true);
create policy "tracker_entries_all" on tracker_entries for all using (true) with check (true);

-- Purchase Orders register (added 2026-09-16). Same conventions.
create table if not exists purchase_orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  po_number text not null,
  office text,                    -- Indonesia | Shanghai | Singapore
  po_date date,
  vendor text default 'CUSTOM S.p.A.',
  currency text default 'USD',
  total numeric,
  notes text,
  attachments jsonb               -- [{name,url}]
);
create table if not exists po_lines (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  po_id uuid not null references purchase_orders(id) on delete cascade,
  pn text,
  description text,
  qty numeric,
  unit text,
  unit_price numeric,
  sort_order int
);
alter table purchase_orders enable row level security;
alter table po_lines enable row level security;
create policy "purchase_orders_all" on purchase_orders for all using (true) with check (true);
create policy "po_lines_all" on po_lines for all using (true) with check (true);

-- 2026-10-07: optional next follow-up date per tracker project
alter table tracker_projects add column if not exists next_followup date;

-- 2026-11-02: low-priority flag (just waiting: sinks to the bottom, no Quiet nag)
alter table tracker_projects add column if not exists low_priority boolean not null default false;

-- 2026-10-13: invoice / payment / receipt tracking on POs (applied live)
alter table purchase_orders
  add column if not exists invoice_no text,
  add column if not exists paid_date date,
  add column if not exists received_date date;
