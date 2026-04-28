import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { format, parseISO, startOfWeek, endOfWeek } from 'date-fns'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AdminClient, type ClinicRow, type DateRangeInfo } from './admin-client'

export const metadata: Metadata = { title: 'Admin' }

type RangeKey = 'today' | 'yesterday' | 'week' | 'custom'

function resolveRange(rangeRaw: string | undefined, dateRaw: string | undefined): DateRangeInfo & { start: Date; end: Date } {
  const now = new Date()
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const endOfDay   = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)

  // A valid YYYY-MM-DD param implicitly switches to "custom" range.
  let key: RangeKey
  if (dateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
    key = 'custom'
  } else if (rangeRaw === 'yesterday' || rangeRaw === 'week' || rangeRaw === 'custom') {
    key = rangeRaw
  } else {
    key = 'today'
  }

  let start: Date
  let end: Date
  let label: string
  let date: string | null = null

  if (key === 'today') {
    start = startOfDay(now)
    end = endOfDay(now)
    label = 'Today'
    date = format(start, 'yyyy-MM-dd')
  } else if (key === 'yesterday') {
    const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
    start = startOfDay(y)
    end = endOfDay(y)
    label = 'Yesterday'
    date = format(start, 'yyyy-MM-dd')
  } else if (key === 'week') {
    start = startOfWeek(now, { weekStartsOn: 1 })
    end = endOfWeek(now, { weekStartsOn: 1 })
    label = 'This week'
    date = null
  } else {
    // custom: validated above. Fallback to today if parseISO fails.
    const parsed = dateRaw ? parseISO(dateRaw) : now
    const safe = isNaN(parsed.getTime()) ? now : parsed
    start = startOfDay(safe)
    end = endOfDay(safe)
    label = format(start, 'EEE dd MMM yyyy')
    date = format(start, 'yyyy-MM-dd')
  }

  return { key, start, end, label, date, startIso: start.toISOString(), endIso: end.toISOString() }
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; date?: string }>
}) {
  const sp = await searchParams
  const range = resolveRange(sp.range, sp.date)
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
        range={{ key: range.key, startIso: range.startIso, endIso: range.endIso, label: range.label, date: range.date }}
        appointmentsInRange={0}
        revenueInRange={0}
        newClinicsInRange={0}
        newClientsInRange={0}
        isDev={isDev}
      />
    )
  }

  // 4. Build owner-email map from Supabase Auth
  const { data: { users: authUsers } } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const ownerEmailMap = new Map(authUsers.map((u) => [u.id, u.email ?? '']))

  // 5. Aggregate stats per clinic + global activity totals in one parallel batch
  const clinicIds = clinics.map((c) => c.id)

  // Range window selected by the date filter (server-side only — no client filtering).
  const rangeStartIso = range.startIso
  const rangeEndIso = range.endIso

  const [
    clientCounts,
    aptCounts,
    revenueApts,
    serviceCounts,
    staffCounts,
    ghlCounts,
    lastActivity,
    aptsInRangeRes,
    revenueInRangeRes,
    newClinicsInRangeRes,
    newClientsInRangeRes,
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
    // Appointments scheduled in selected range
    admin
      .from('appointments')
      .select('*', { count: 'exact', head: true })
      .gte('starts_at', rangeStartIso)
      .lte('starts_at', rangeEndIso)
      .in('status', ['pending', 'confirmed', 'completed']),
    // Revenue from completed appointments in selected range
    admin
      .from('appointments')
      .select('price, service:services(price)')
      .eq('status', 'completed')
      .gte('starts_at', rangeStartIso)
      .lte('starts_at', rangeEndIso),
    // New clinics created in selected range
    admin
      .from('clinics')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', rangeStartIso)
      .lte('created_at', rangeEndIso),
    // New clients added in selected range
    admin
      .from('clients')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', rangeStartIso)
      .lte('created_at', rangeEndIso),
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

  const appointmentsInRange = aptsInRangeRes.count ?? 0
  const revenueInRange = sumPrice(revenueInRangeRes.data)
  const newClinicsInRange = newClinicsInRangeRes.count ?? 0
  const newClientsInRange = newClientsInRangeRes.count ?? 0

  return (
    <AdminClient
      clinics={rows}
      adminEmail={user.email}
      mrr={mrr}
      range={{ key: range.key, startIso: range.startIso, endIso: range.endIso, label: range.label, date: range.date }}
      appointmentsInRange={appointmentsInRange}
      revenueInRange={revenueInRange}
      newClinicsInRange={newClinicsInRange}
      newClientsInRange={newClientsInRange}
      isDev={isDev}
    />
  )
}
