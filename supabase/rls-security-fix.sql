-- ============================================================
-- RLS Security Fix — run once in Supabase SQL editor
-- ============================================================

-- 1. Remove the blanket public-write policy that allowed any status
drop policy if exists "Public can book appointment" on appointments;

-- 2. Remove the blanket public-read policy that exposed all appointments
drop policy if exists "Public read clinic bookings" on appointments;

-- 3. Restrict public inserts: only status='pending', only when clinic has
--    booking enabled. This prevents external callers from injecting
--    confirmed/completed appointments.
create policy "Public can book appointment"
  on appointments for insert
  with check (
    status = 'pending'
    and exists (
      select 1 from clinics
      where id = clinic_id
        and booking_enabled = true
    )
  );

-- 4. Staff/owner select policy already exists ("Staff manage appointments").
--    No public read policy is needed — the booking page only reads services,
--    not appointments. The GHL route uses the service-role key (bypasses RLS).
