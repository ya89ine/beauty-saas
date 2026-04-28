-- ============================================================
-- Admin Panel — run once in Supabase SQL editor
-- ============================================================

alter table clinics
  add column if not exists subscription_status text not null default 'trial'
    check (subscription_status in ('trial', 'active', 'paused')),
  add column if not exists admin_notes text;
