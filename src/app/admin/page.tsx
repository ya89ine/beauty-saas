import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { parseISO } from 'date-fns'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AdminClient, type ClinicRow } from './admin-client'

export const metadata: Metadata = { title: 'Admin' }

export default async function AdminPage() {
  // /admin gating is owned by src/proxy.ts (single source of truth).
  // Here we only fetch the user for display. Any non-admin would have
  // been redirected upstream by the proxy.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user || !user.email) redirect('/login')

  const admin = createAdminClient()

  // 3. Fetch all clinics
  const { data: clinics } = await admin
    .from('clinics')
    .select('id, name, slug, created_at, owner_id, email, subscription_status, admin_notes, booking_enabled, monthly_price, billing_notes, trial_started_at, trial_ends_at, current_period_end')
    .order('created_at', { ascending: false })

  const isDev = process.env.NODE_ENV !== 'production'

  // Always render the dashboard — even with 0 clinics. The client component
  // shows the inline create form expanded by default in that case.
  if (!clinics || clinics.length === 0) {
    return (
      <AdminClient
        clinics={[]}
        adminEmail={user.email}
        mrr={0}
        appointmentsToday={0}
        revenueToday={0}
        appointmentsThisMonth={0}
        revenueThisMonth={0}
        newClinicsThisMonth={0}
        isDev={isDev}
      />
    )
  }

  // 4. Build owner-email map from Supabase Auth
  const { data: { users: authUsers } } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const ownerEmailMap = new Map(authUsers.map((u) => [u.id, u.email ?? '']))

  // 5. Aggregate stats per clinic + global activity totals in one parallel batch
  const clinicIds = clinics.map((c) => c.id)

  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const todayStartIso = todayStart.toISOString()
  const todayEndIso = todayEnd.toISOString()
  const monthStartIso = monthStart.toISOString()

  const [
    clientCounts,
    aptCounts,
    revenueApts,
    serviceCounts,
    staffCounts,
    ghlCounts,
    lastActivity,
    aptsTodayRes,
    revenueTodayRes,
    aptsThisMonthRes,
    revenueThisMonthRes,
  ] = await Promise.all([
    // Clients per clinic
    Promise.all(
      clinicIds.map((id) =>
        admin
          .from('clients')
          .select('*', { count: 'exact', head: true })
          .eq('clinic_id', id)
          .then(({ count }) => ({ id, count: count ?? 0 })),
      ),
    ),
    // Non-cancelled appointments per clinic
    Promise.all(
      clinicIds.map((id) =>
        admin
          .from('appointments')
          .select('*', { count: 'exact', head: true })
          .eq('clinic_id', id)
          .in('status', ['pending', 'confirmed', 'completed'])
          .then(({ count }) => ({ id, count: count ?? 0 })),
      ),
    ),
    // Revenue: completed appointments with service price
    Promise.all(
      clinicIds.map((id) =>
        admin
          .from('appointments')
          .select('service:services(price)')
          .eq('clinic_id', id)
          .eq('status', 'completed')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .then(({ data }) => ({ id, data: (data ?? []) as any[] })),
      ),
    ),
    // Active services per clinic
    Promise.all(
      clinicIds.map((id) =>
        admin
          .from('services')
          .select('*', { count: 'exact', head: true })
          .eq('clinic_id', id)
          .eq('is_active', true)
          .then(({ count }) => ({ id, count: count ?? 0 })),
      ),
    ),
    // Active staff per clinic
    Promise.all(
      clinicIds.map((id) =>
        admin
          .from('staff')
          .select('*', { count: 'exact', head: true })
          .eq('clinic_id', id)
          .eq('is_active', true)
          .then(({ count }) => ({ id, count: count ?? 0 })),
      ),
    ),
    // GHL heuristic: any appointment with a phone number
    Promise.all(
      clinicIds.map((id) =>
        admin
          .from('appointments')
          .select('*', { count: 'exact', head: true })
          .eq('clinic_id', id)
          .not('client_phone', 'is', null)
          .then(({ count }) => ({ id, count: count ?? 0 })),
      ),
    ),
    // Last activity: most-recent appointment.created_at per clinic
    Promise.all(
      clinicIds.map((id) =>
        admin
          .from('appointments')
          .select('created_at')
          .eq('clinic_id', id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
          .then(({ data }) => ({ id, lastActiveAt: data?.created_at ?? null })),
      ),
    ),
    // Appointments scheduled today
    admin
      .from('appointments')
      .select('*', { count: 'exact', head: true })
      .gte('starts_at', todayStartIso)
      .lte('starts_at', todayEndIso)
      .in('status', ['pending', 'confirmed', 'completed']),
    // Revenue today
    admin
      .from('appointments')
      .select('price, service:services(price)')
      .eq('status', 'completed')
      .gte('starts_at', todayStartIso)
      .lte('starts_at', todayEndIso),
    // Appointments scheduled this month
    admin
      .from('appointments')
      .select('*', { count: 'exact', head: true })
      .gte('starts_at', monthStartIso)
      .in('status', ['pending', 'confirmed', 'completed']),
    // Revenue this month
    admin
      .from('appointments')
      .select('price, service:services(price)')
      .eq('status', 'completed')
      .gte('starts_at', monthStartIso),
  ])

  const clientMap   = new Map(clientCounts.map(({ id, count }) => [id, count]))
  const aptMap      = new Map(aptCounts.map(({ id, count }) => [id, count]))
  const serviceMap  = new Map(serviceCounts.map(({ id, count }) => [id, count]))
  const staffMap    = new Map(staffCounts.map(({ id, count }) => [id, count]))
  const ghlMap      = new Map(ghlCounts.map(({ id, count }) => [id, count]))
  const activityMap = new Map(lastActivity.map(({ id, lastActiveAt }) => [id, lastActiveAt]))
  const revenueMap = new Map(
    revenueApts.map(({ id, data }) => [
      id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data.reduce((sum: number, a: any) => sum + (a.service?.price ?? 0), 0),
    ]),
  )

  const rows: ClinicRow[] = clinics.map((clinic) => ({
    id: clinic.id,
    name: clinic.name,
    slug: clinic.slug,
    created_at: clinic.created_at,
    ownerEmail: ownerEmailMap.get(clinic.owner_id) ?? clinic.email ?? '—',
    subscription_status: (clinic.subscription_status ?? 'trial') as ClinicRow['subscription_status'],
    admin_notes: clinic.admin_notes ?? null,
    booking_enabled: clinic.booking_enabled ?? false,
    monthly_price: clinic.monthly_price ?? null,
    billing_notes: clinic.billing_notes ?? null,
    trial_started_at: clinic.trial_started_at ?? null,
    trial_ends_at: clinic.trial_ends_at ?? null,
    current_period_end: clinic.current_period_end ?? null,
    last_active_at: activityMap.get(clinic.id) ?? null,
    totalClients: clientMap.get(clinic.id) ?? 0,
    totalAppointments: aptMap.get(clinic.id) ?? 0,
    revenue: revenueMap.get(clinic.id) ?? 0,
    hasServices: (serviceMap.get(clinic.id) ?? 0) > 0,
    hasStaff: (staffMap.get(clinic.id) ?? 0) > 0,
    hasAppointments: (aptMap.get(clinic.id) ?? 0) > 0,
    ghlConnected: (ghlMap.get(clinic.id) ?? 0) > 0,
  }))

  // MRR = sum of monthly_price across active subscriptions
  const mrr = rows
    .filter((c) => c.subscription_status === 'active')
    .reduce((sum, c) => sum + (c.monthly_price ?? 0), 0)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sumPrice = (data: any[] | null) =>
    (data ?? []).reduce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sum: number, a: any) => sum + (a.price ?? a.service?.price ?? 0),
      0,
    )

  const appointmentsToday = aptsTodayRes.count ?? 0
  const revenueToday = sumPrice(revenueTodayRes.data)
  const appointmentsThisMonth = aptsThisMonthRes.count ?? 0
  const revenueThisMonth = sumPrice(revenueThisMonthRes.data)
  const newClinicsThisMonth = rows.filter((c) => parseISO(c.created_at) >= monthStart).length

  return (
    <AdminClient
      clinics={rows}
      adminEmail={user.email}
      mrr={mrr}
      appointmentsToday={appointmentsToday}
      revenueToday={revenueToday}
      appointmentsThisMonth={appointmentsThisMonth}
      revenueThisMonth={revenueThisMonth}
      newClinicsThisMonth={newClinicsThisMonth}
      isDev={isDev}
    />
  )
}
