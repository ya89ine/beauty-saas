-- ============================================================
-- Admin Panel V1 — subscription dates
-- Run once in the Supabase SQL editor
-- ============================================================

alter table clinics
  add column if not exists trial_started_at  timestamptz default now(),
  add column if not exists trial_ends_at     timestamptz default (now() + interval '14 days'),
  add column if not exists current_period_end timestamptz;

-- Backfill: existing trial clinics get a 14-day window from their created_at
update clinics
   set trial_started_at = created_at,
       trial_ends_at    = created_at + interval '14 days'
 where trial_started_at is null
    or trial_ends_at    is null;
