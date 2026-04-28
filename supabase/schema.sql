-- ============================================================
-- Beauty SaaS - Database Schema
-- Run this in your Supabase SQL editor
-- ============================================================

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ============================================================
-- CLINICS (Multi-tenant root)
-- ============================================================
create table if not exists clinics (
  id          uuid primary key default uuid_generate_v4(),
  created_at  timestamptz not null default now(),
  name        text not null,
  slug        text not null unique,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  email       text,
  phone       text,
  address     text,
  logo_url    text,
  timezone    text not null default 'UTC',
  booking_enabled boolean not null default true
);

-- ============================================================
-- STAFF
-- ============================================================
create table if not exists staff (
  id          uuid primary key default uuid_generate_v4(),
  created_at  timestamptz not null default now(),
  clinic_id   uuid not null references clinics(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  name        text not null,
  email       text not null,
  phone       text,
  role        text not null default 'staff' check (role in ('owner', 'manager', 'staff')),
  avatar_url  text,
  is_active   boolean not null default true
);

-- ============================================================
-- SERVICES
-- ============================================================
create table if not exists services (
  id                uuid primary key default uuid_generate_v4(),
  created_at        timestamptz not null default now(),
  clinic_id         uuid not null references clinics(id) on delete cascade,
  name              text not null,
  description       text,
  duration_minutes  integer not null check (duration_minutes > 0),
  price             numeric(10, 2) not null check (price >= 0),
  currency          text not null default 'USD',
  category          text,
  is_active         boolean not null default true,
  color             text
);

-- ============================================================
-- CLIENTS
-- ============================================================
create table if not exists clients (
  id            uuid primary key default uuid_generate_v4(),
  created_at    timestamptz not null default now(),
  clinic_id     uuid not null references clinics(id) on delete cascade,
  name          text not null,
  email         text,
  phone         text,
  notes         text,
  date_of_birth date,
  avatar_url    text
);

-- ============================================================
-- APPOINTMENTS
-- ============================================================
create table if not exists appointments (
  id            uuid primary key default uuid_generate_v4(),
  created_at    timestamptz not null default now(),
  clinic_id     uuid not null references clinics(id) on delete cascade,
  client_id     uuid references clients(id) on delete set null,
  staff_id      uuid references staff(id) on delete set null,
  service_id    uuid not null references services(id) on delete restrict,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  status        text not null default 'pending' check (
                  status in ('pending', 'confirmed', 'cancelled', 'completed', 'no_show')
                ),
  notes         text,
  -- Denormalized for guest bookings (no client record yet)
  client_name   text not null,
  client_email  text,
  client_phone  text,
  constraint valid_time_range check (ends_at > starts_at)
);

-- ============================================================
-- INDEXES
-- ============================================================
create index if not exists idx_staff_clinic_id       on staff(clinic_id);
create index if not exists idx_services_clinic_id    on services(clinic_id);
create index if not exists idx_clients_clinic_id     on clients(clinic_id);
create index if not exists idx_appointments_clinic   on appointments(clinic_id);
create index if not exists idx_appointments_starts   on appointments(starts_at);
create index if not exists idx_appointments_status   on appointments(status);
create index if not exists idx_clinics_slug          on clinics(slug);
create index if not exists idx_clinics_owner         on clinics(owner_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table clinics      enable row level security;
alter table staff        enable row level security;
alter table services     enable row level security;
alter table clients      enable row level security;
alter table appointments enable row level security;

-- Helper: is the current user a staff member of a clinic?
create or replace function is_clinic_staff(p_clinic_id uuid)
returns boolean language sql security definer as $$
  select exists (
    select 1 from staff
    where clinic_id = p_clinic_id
      and user_id = auth.uid()
      and is_active = true
  );
$$;

-- Clinics: owners can do everything; staff can read their clinic
create policy "Clinic owner full access"
  on clinics for all
  using (owner_id = auth.uid());

create policy "Staff can read own clinic"
  on clinics for select
  using (is_clinic_staff(id));

-- Staff: clinic staff can read; owners/managers can manage
create policy "Staff read own clinic"
  on staff for select
  using (is_clinic_staff(clinic_id));

create policy "Owner manages staff"
  on staff for all
  using (
    exists (
      select 1 from clinics where id = clinic_id and owner_id = auth.uid()
    )
  );

-- Services: clinic staff can read; owners manage
create policy "Staff read services"
  on services for select
  using (is_clinic_staff(clinic_id));

create policy "Owner manages services"
  on services for all
  using (
    exists (
      select 1 from clinics where id = clinic_id and owner_id = auth.uid()
    )
  );

-- Public can read active services for booking page
create policy "Public read active services"
  on services for select
  using (is_active = true);

-- Clients: clinic staff can read/write
create policy "Staff manage clients"
  on clients for all
  using (is_clinic_staff(clinic_id));

-- Appointments: staff manage; public can only insert pending bookings
create policy "Staff manage appointments"
  on appointments for all
  using (is_clinic_staff(clinic_id));

-- Public insert is restricted: status must be 'pending' and the clinic must
-- have booking enabled. Prevents injecting confirmed/completed appointments.
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

-- ============================================================
-- FUNCTION: Create clinic with owner staff record
-- ============================================================
create or replace function create_clinic_with_owner(
  p_name    text,
  p_slug    text,
  p_email   text default null,
  p_phone   text default null
)
returns uuid language plpgsql security definer as $$
declare
  v_clinic_id  uuid;
  v_user_name  text;
  v_user_email text;
begin
  select
    coalesce(raw_user_meta_data->>'full_name', email),
    email
  into v_user_name, v_user_email
  from auth.users where id = auth.uid();

  insert into clinics (name, slug, owner_id, email, phone)
  values (p_name, p_slug, auth.uid(), p_email, p_phone)
  returning id into v_clinic_id;

  insert into staff (clinic_id, user_id, name, email, role)
  values (v_clinic_id, auth.uid(), v_user_name, coalesce(p_email, v_user_email), 'owner');

  return v_clinic_id;
end;
$$;
