'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAdminEmail } from '@/lib/admin'

type Result = { error?: string; success?: boolean; message?: string }

const DEMO_SLUG_PREFIX = 'demo-'
const DEMO_EMAIL_DOMAIN = '@demo.local'
const DEMO_PASSWORD = 'demopassword123'
const DAY_MS = 86_400_000

async function verifyAdmin(): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdminEmail(user.email)) return { error: 'Unauthorized' }
  return { ok: true }
}

function ensureDev(): { error: string } | null {
  if (process.env.NODE_ENV === 'production') {
    return { error: 'Demo seeding is disabled in production' }
  }
  return null
}

// ── SEED ─────────────────────────────────────────────────────────────────────

type ClinicPlan = {
  slug: string
  name: string
  ownerEmail: string
  ownerName: string
  subscription_status: 'trial' | 'active' | 'paused'
  monthly_price: number
  daysAgoCreated: number
  trialStartedDaysAgo?: number
  trialEndsInDays?: number
  currentPeriodEndsInDays?: number
  appointmentPlan: 'active-busy' | 'trial-stalled' | 'paused-old'
  admin_notes: string
}

const PLANS: ClinicPlan[] = [
  {
    slug: 'demo-glow-spa-casablanca',
    name: 'Demo · Glow Spa Casablanca',
    ownerEmail: 'demo-glow@demo.local',
    ownerName: 'Fatima (demo)',
    subscription_status: 'active',
    monthly_price: 499,
    daysAgoCreated: 60,
    currentPeriodEndsInDays: 25,
    appointmentPlan: 'active-busy',
    admin_notes: 'Demo · paying customer · healthy activity',
  },
  {
    slug: 'demo-marrakech-beauty-lounge',
    name: 'Demo · Marrakech Beauty Lounge',
    ownerEmail: 'demo-marrakech@demo.local',
    ownerName: 'Yasmine (demo)',
    subscription_status: 'trial',
    monthly_price: 299,
    daysAgoCreated: 12,
    trialStartedDaysAgo: 12,
    trialEndsInDays: 2,
    appointmentPlan: 'trial-stalled',
    admin_notes: 'Demo · trial about to expire · no bookings yet',
  },
  {
    slug: 'demo-rabat-aesthetic-center',
    name: 'Demo · Rabat Aesthetic Center',
    ownerEmail: 'demo-rabat@demo.local',
    ownerName: 'Nadia (demo)',
    subscription_status: 'paused',
    monthly_price: 399,
    daysAgoCreated: 90,
    appointmentPlan: 'paused-old',
    admin_notes: 'Demo · paused · churn risk',
  },
]

const SERVICES = [
  { name: 'Manicure Classic',  duration_minutes: 45,  price: 200, color: '#F87171' },
  { name: 'Hydrating Facial',  duration_minutes: 60,  price: 450, color: '#34D399' },
  { name: 'Hair Color & Cut',  duration_minutes: 120, price: 850, color: '#60A5FA' },
  { name: 'Spa Massage 90′',   duration_minutes: 90,  price: 700, color: '#A78BFA' },
]

const STAFF_NAMES: Array<{ name: string; role: 'manager' | 'staff' }> = [
  { name: 'Fatima Z.',  role: 'manager' },
  { name: 'Khadija R.', role: 'staff' },
  { name: 'Sofia A.',   role: 'staff' },
  { name: 'Yasmine B.', role: 'staff' },
  { name: 'Imane K.',   role: 'staff' },
]

const CLIENT_POOL = [
  'Aisha M.', 'Salma K.', 'Leila B.', 'Hanane S.', 'Rim A.', 'Nora D.',
  'Sara T.', 'Hajar O.',
]

type ApptPlanRow = {
  daysOffset: number
  hour: number
  serviceIdx: number
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'
}

function buildApptPlan(kind: ClinicPlan['appointmentPlan']): ApptPlanRow[] {
  if (kind === 'trial-stalled') return []

  if (kind === 'active-busy') {
    const rows: ApptPlanRow[] = []
    // Past 14 days: ~22 appointments, mostly completed
    let serviceIdx = 0
    for (let d = 14; d >= 1; d--) {
      // 1-2 per day
      const count = d % 3 === 0 ? 2 : 1
      for (let i = 0; i < count; i++) {
        const status =
          rows.length % 13 === 0 ? 'cancelled' :
          rows.length % 17 === 0 ? 'no_show' :
          'completed'
        rows.push({
          daysOffset: -d,
          hour: 10 + i * 4,
          serviceIdx: serviceIdx % SERVICES.length,
          status,
        })
        serviceIdx++
      }
    }
    // Today: 2 confirmed
    rows.push({ daysOffset: 0, hour: 10, serviceIdx: 1, status: 'confirmed' })
    rows.push({ daysOffset: 0, hour: 15, serviceIdx: 2, status: 'confirmed' })
    // Next 7 days: 5 confirmed + 1 pending
    for (let d = 1; d <= 5; d++) {
      rows.push({ daysOffset: d, hour: 11, serviceIdx: d % SERVICES.length, status: 'confirmed' })
    }
    rows.push({ daysOffset: 6, hour: 16, serviceIdx: 3, status: 'pending' })
    return rows
  }

  // paused-old: 12 appointments, all 30-90 days ago
  const rows: ApptPlanRow[] = []
  for (let i = 0; i < 12; i++) {
    rows.push({
      daysOffset: -(30 + i * 5),
      hour: 11 + (i % 4),
      serviceIdx: i % SERVICES.length,
      status: i % 5 === 0 ? 'cancelled' : 'completed',
    })
  }
  return rows
}

export async function seedDemoData(): Promise<Result> {
  const dev = ensureDev()
  if (dev) return dev

  const check = await verifyAdmin()
  if ('error' in check) return { error: check.error }

  const admin = createAdminClient()

  // Idempotency: skip if any demo clinic already exists
  const { data: existing } = await admin
    .from('clinics')
    .select('id')
    .like('slug', `${DEMO_SLUG_PREFIX}%`)
    .limit(1)

  if (existing && existing.length > 0) {
    return { error: 'Demo data already seeded — clear it first to re-seed' }
  }

  const now = new Date()

  for (const plan of PLANS) {
    // 1. Resolve or create owner auth user (idempotent at the user level)
    let ownerId: string | null = null
    const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 })
    const found = users.find((u) => u.email === plan.ownerEmail)
    if (found) {
      ownerId = found.id
    } else {
      const { data: authData, error: authError } = await admin.auth.admin.createUser({
        email: plan.ownerEmail,
        password: DEMO_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: plan.ownerName, demo: true },
      })
      if (authError || !authData?.user) {
        return { error: `Failed to create owner ${plan.ownerEmail}: ${authError?.message ?? 'unknown'}` }
      }
      ownerId = authData.user.id
    }

    // 2. Create clinic
    const created_at = new Date(now.getTime() - plan.daysAgoCreated * DAY_MS).toISOString()
    const trial_started_at = plan.trialStartedDaysAgo !== undefined
      ? new Date(now.getTime() - plan.trialStartedDaysAgo * DAY_MS).toISOString()
      : null
    const trial_ends_at = plan.trialEndsInDays !== undefined
      ? new Date(now.getTime() + plan.trialEndsInDays * DAY_MS).toISOString()
      : null
    const current_period_end = plan.currentPeriodEndsInDays !== undefined
      ? new Date(now.getTime() + plan.currentPeriodEndsInDays * DAY_MS).toISOString()
      : null

    const { data: clinic, error: clinicError } = await admin
      .from('clinics')
      .insert({
        name: plan.name,
        slug: plan.slug,
        owner_id: ownerId,
        email: plan.ownerEmail,
        timezone: 'Africa/Casablanca',
        booking_enabled: true,
        subscription_status: plan.subscription_status,
        monthly_price: plan.monthly_price,
        admin_notes: plan.admin_notes,
        billing_notes: 'Demo price · not billed',
        trial_started_at,
        trial_ends_at,
        current_period_end,
        created_at,
      })
      .select('id')
      .single()

    if (clinicError || !clinic) {
      return { error: `Failed to create clinic ${plan.slug}: ${clinicError?.message ?? 'unknown'}` }
    }
    const clinicId = clinic.id

    // 3. Staff (5 rows, first one = owner linked to auth user)
    const staffRows: Array<{
      clinic_id: string
      user_id: string | null
      name: string
      email: string
      role: 'owner' | 'manager' | 'staff'
      is_active: boolean
    }> = STAFF_NAMES.map((s, i) => ({
      clinic_id: clinicId,
      user_id: i === 0 ? ownerId : null,
      name: s.name,
      email: i === 0
        ? plan.ownerEmail
        : `${s.name.toLowerCase().replace(/[^a-z]/g, '')}-${plan.slug}${DEMO_EMAIL_DOMAIN}`,
      role: i === 0 ? 'owner' : s.role,
      is_active: true,
    }))
    const { data: createdStaff, error: staffError } = await admin
      .from('staff')
      .insert(staffRows)
      .select('id')
    if (staffError) return { error: `Failed to create staff: ${staffError.message}` }
    const staffIds = (createdStaff ?? []).map((s) => s.id)

    // 4. Services
    const serviceRows = SERVICES.map((s) => ({
      clinic_id: clinicId,
      name: s.name,
      duration_minutes: s.duration_minutes,
      price: s.price,
      currency: 'MAD',
      color: s.color,
      is_active: true,
    }))
    const { data: createdServices, error: serviceError } = await admin
      .from('services')
      .insert(serviceRows)
      .select('id, duration_minutes, price')
    if (serviceError || !createdServices) {
      return { error: `Failed to create services: ${serviceError?.message ?? 'unknown'}` }
    }

    // 5. Clients (6 per clinic)
    const clientRows = CLIENT_POOL.slice(0, 6).map((name, i) => ({
      clinic_id: clinicId,
      name,
      phone: `+21260${String(1000000 + i + plan.daysAgoCreated).slice(0, 7)}`,
      email: null as string | null,
    }))
    const { data: createdClients, error: clientError } = await admin
      .from('clients')
      .insert(clientRows)
      .select('id, name, phone')
    if (clientError || !createdClients) {
      return { error: `Failed to create clients: ${clientError?.message ?? 'unknown'}` }
    }

    // 6. Appointments
    const apptPlan = buildApptPlan(plan.appointmentPlan)
    if (apptPlan.length > 0) {
      const apptRows = apptPlan.map((row, i) => {
        const svc = createdServices[row.serviceIdx]
        const client = createdClients[i % createdClients.length]
        const start = new Date(now.getTime() + row.daysOffset * DAY_MS)
        start.setHours(row.hour, 0, 0, 0)
        const end = new Date(start.getTime() + svc.duration_minutes * 60_000)
        // Booked the day before (createdAt < startsAt)
        const apptCreated = new Date(start.getTime() - DAY_MS)
        return {
          clinic_id: clinicId,
          service_id: svc.id,
          staff_id: staffIds[i % staffIds.length] ?? null,
          client_id: client.id,
          starts_at: start.toISOString(),
          ends_at: end.toISOString(),
          status: row.status,
          client_name: client.name,
          client_phone: client.phone,
          client_email: null,
          notes: null,
          created_at: apptCreated.toISOString(),
        }
      })
      const { error: apptError } = await admin.from('appointments').insert(apptRows)
      if (apptError) return { error: `Failed to create appointments: ${apptError.message}` }
    }
  }

  revalidatePath('/admin')
  return {
    success: true,
    message: `Seeded ${PLANS.length} demo clinics with staff, services, clients, and appointments.`,
  }
}

// ── CLEAR ────────────────────────────────────────────────────────────────────

export async function clearDemoData(): Promise<Result> {
  const dev = ensureDev()
  if (dev) return dev

  const check = await verifyAdmin()
  if ('error' in check) return { error: check.error }

  const admin = createAdminClient()

  // Find demo clinics by slug prefix
  const { data: demoClinics, error: findErr } = await admin
    .from('clinics')
    .select('id, owner_id, slug')
    .like('slug', `${DEMO_SLUG_PREFIX}%`)

  if (findErr) return { error: `Failed to find demo data: ${findErr.message}` }
  if (!demoClinics || demoClinics.length === 0) {
    return { error: 'No demo data found' }
  }

  const clinicIds = demoClinics.map((c) => c.id)

  // FK cascades will clean up staff/services/clients/appointments
  const { error: delErr } = await admin.from('clinics').delete().in('id', clinicIds)
  if (delErr) return { error: `Failed to delete demo clinics: ${delErr.message}` }

  // Delete owner auth users (only the demo ones, identified by email domain)
  const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 })
  for (const u of users) {
    if (u.email && u.email.endsWith(DEMO_EMAIL_DOMAIN)) {
      await admin.auth.admin.deleteUser(u.id)
    }
  }

  revalidatePath('/admin')
  return {
    success: true,
    message: `Cleared ${demoClinics.length} demo ${demoClinics.length === 1 ? 'clinic' : 'clinics'}.`,
  }
}
