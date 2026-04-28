import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { format, parseISO, startOfMonth, endOfMonth } from 'date-fns'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AppointmentsClient, type ActiveFilter, type AptStatusKey } from './appointments-client'

export const metadata: Metadata = { title: 'Appointments' }

// Single source of truth for which statuses exist in the schema. The filter UI
// renders chips for each of these. Keeping it co-located with the page (and
// re-imported by the client) means the URL/UI/DB stay in lockstep.
export const ALL_STATUSES: readonly AptStatusKey[] = [
  'pending',
  'confirmed',
  'completed',
  'cancelled',
  'no_show',
] as const

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

function parseStatuses(raw: string | string[] | undefined): AptStatusKey[] {
  if (!raw) return [...ALL_STATUSES]
  const list = Array.isArray(raw) ? raw : raw.split(',')
  const valid = list
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is AptStatusKey =>
      (ALL_STATUSES as readonly string[]).includes(s),
    )
  // Empty / all-invalid → no filter (show everything).
  return valid.length > 0 ? Array.from(new Set(valid)) : [...ALL_STATUSES]
}

function parseRange(rawFrom: string | undefined, rawTo: string | undefined) {
  // Default window = current month. This matches the "This month" quick view
  // and bounds the query so a clinic with years of history doesn't pull
  // everything on first paint.
  const today = new Date()
  const fromBase = rawFrom && DAY_RE.test(rawFrom) ? parseISO(rawFrom) : startOfMonth(today)
  const toBase   = rawTo   && DAY_RE.test(rawTo)   ? parseISO(rawTo)   : endOfMonth(today)
  const from = new Date(fromBase.getFullYear(), fromBase.getMonth(), fromBase.getDate())
  const to   = new Date(toBase.getFullYear(),   toBase.getMonth(),   toBase.getDate(), 23, 59, 59, 999)
  return {
    from,
    to,
    fromStr: format(from, 'yyyy-MM-dd'),
    toStr:   format(to,   'yyyy-MM-dd'),
  }
}

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; from?: string; to?: string }>
}) {
  const sp = await searchParams
  const statuses = parseStatuses(sp.status)
  const allStatusesSelected = statuses.length === ALL_STATUSES.length
  const { from, to, fromStr, toStr } = parseRange(sp.from, sp.to)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const admin = createAdminClient()

  const { data: clinic } = await admin
    .from('clinics')
    .select('id')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!clinic) {
    return (
      <div className="flex flex-col items-start gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">Appointments</h1>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have a clinic set up yet.
        </p>
        <Link
          href="/onboarding"
          className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
        >
          Create clinic
        </Link>
      </div>
    )
  }

  // Server-side query with the filter applied. Range is bounded by the date
  // window; status is only narrowed when the user chose a subset (otherwise we
  // skip the `.in()` so the query planner can stay on the (clinic_id, starts_at)
  // path without an extra filter).
  let aptQuery = admin
    .from('appointments')
    .select('*, service:services(name, duration_minutes), staff:staff(name)')
    .eq('clinic_id', clinic.id)
    .gte('starts_at', from.toISOString())
    .lte('starts_at', to.toISOString())
    .order('starts_at', { ascending: true })

  if (!allStatusesSelected) {
    aptQuery = aptQuery.in('status', statuses)
  }

  const [
    { data: rawAppointments },
    { data: services },
    { data: staffList },
  ] = await Promise.all([
    aptQuery,
    admin
      .from('services')
      .select('*')
      .eq('clinic_id', clinic.id)
      .eq('is_active', true)
      .order('name'),
    admin
      .from('staff')
      .select('*')
      .eq('clinic_id', clinic.id)
      .order('name'),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const appointments = (rawAppointments ?? []) as any[]

  const filter: ActiveFilter = {
    statuses,
    fromStr,
    toStr,
    allStatusesSelected,
  }

  return (
    <AppointmentsClient
      appointments={appointments}
      services={services ?? []}
      staffList={staffList ?? []}
      filter={filter}
    />
  )
}
