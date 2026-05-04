import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ClientsClient, type ClientBilling } from './clients-client'
import { autoCompletePastAppointments } from '../appointments/actions'

export const metadata: Metadata = { title: 'Clients' }

export default async function ClientsPage() {
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
        <h1 className="text-3xl font-semibold tracking-tight">Clients</h1>
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

  // Auto-complete elapsed appointments before billing aggregation so the
  // numbers reflect sessions that just finished.
  await autoCompletePastAppointments(clinic.id)

  const [
    { data: clients },
    { data: appointments },
    { data: packages },
    { data: payments },
    { data: services },
  ] = await Promise.all([
    admin
      .from('clients')
      .select('*')
      .eq('clinic_id', clinic.id)
      .order('name'),
    // Pull every appointment so we can compute per-client session counts and
    // committed value. `appointments.price` is snapshotted at booking; for
    // pre-snapshot rows with a NULL price we fall back to the current service
    // price (joined manually via `services` below — Supabase's PostgREST
    // embed isn't typed reliably for this pair).
    admin
      .from('appointments')
      .select('id, client_id, service_id, status, is_paid, price, package_id')
      .eq('clinic_id', clinic.id),
    admin
      .from('treatment_packages')
      .select('id, client_id, total_price, paid_amount, total_sessions, completed_sessions, status')
      .eq('clinic_id', clinic.id),
    admin
      .from('package_payments')
      .select('package_id, amount')
      .eq('clinic_id', clinic.id),
    admin
      .from('services')
      .select('id, price')
      .eq('clinic_id', clinic.id),
  ])

  // Service id → current price, used only as a fallback for legacy
  // appointments that don't have `price` snapshotted on the row.
  const servicePrice = new Map<string, number>()
  for (const s of services ?? []) servicePrice.set(s.id, s.price)

  const billing = computeClientBilling(
    clients ?? [],
    (appointments ?? []).map((a) => ({
      client_id: a.client_id,
      status: a.status,
      is_paid: a.is_paid,
      price: a.price,
      package_id: a.package_id,
      service: a.service_id ? { price: servicePrice.get(a.service_id) ?? 0 } : null,
    })),
    packages ?? [],
    payments ?? [],
  )

  return <ClientsClient clients={clients ?? []} billing={billing} />
}

// Aggregate per-client financials.
//
//   • paid: package payments (apportioned to their package's client) plus
//     any standalone appointment marked is_paid.
//   • delivered_value: monetary value of completed appointments (the
//     "sessions used" totals, in money). For appointments tied to a package
//     we still credit the per-appointment price so the client view reflects
//     true throughput.
//   • committed: total billable owed = package totals + non-package
//     appointment prices for completed/upcoming work.
//   • balance = committed − paid (positive = client owes, negative = credit).
//   • sessionsUsed: count of completed appointments.
//   • sessionsRemaining: SUM of (package.total_sessions - completed_sessions)
//     across this client's active packages — the "remaining sessions" the
//     prompt asked for.
function computeClientBilling(
  clients: Array<{ id: string }>,
  appointments: Array<{
    client_id: string | null
    status: string
    is_paid: boolean
    price: number | null
    package_id: string | null
    service: { price: number } | null
  }>,
  packages: Array<{
    id: string
    client_id: string
    total_price: number
    paid_amount: number
    total_sessions: number
    completed_sessions: number
    status: string
  }>,
  payments: Array<{ package_id: string; amount: number }>,
): Map<string, ClientBilling> {
  // package_id → client_id, so package payments can be attributed to a client.
  const pkgClient = new Map<string, string>()
  for (const p of packages) pkgClient.set(p.id, p.client_id)

  const out = new Map<string, ClientBilling>()
  for (const c of clients) {
    out.set(c.id, {
      paid: 0,
      deliveredValue: 0,
      committed: 0,
      balance: 0,
      sessionsUsed: 0,
      sessionsRemaining: 0,
      activePackages: 0,
    })
  }

  for (const apt of appointments) {
    if (!apt.client_id) continue
    const row = out.get(apt.client_id)
    if (!row) continue
    const aptValue = apt.price ?? apt.service?.price ?? 0

    if (apt.status === 'completed') {
      row.sessionsUsed += 1
      row.deliveredValue += aptValue
    }
    // Non-package appointments contribute their own price to the committed
    // total (package totals are added separately below). Cancelled and
    // no-show rows shouldn't bill — skip them.
    if (
      !apt.package_id &&
      apt.status !== 'cancelled' &&
      apt.status !== 'no_show'
    ) {
      row.committed += aptValue
      if (apt.is_paid) row.paid += aptValue
    }
  }

  for (const pkg of packages) {
    const row = out.get(pkg.client_id)
    if (!row) continue
    if (pkg.status !== 'cancelled') {
      row.committed += pkg.total_price
    }
    if (pkg.status === 'active') {
      row.activePackages += 1
      row.sessionsRemaining += Math.max(0, pkg.total_sessions - pkg.completed_sessions)
    }
  }

  for (const pay of payments) {
    const clientId = pkgClient.get(pay.package_id)
    if (!clientId) continue
    const row = out.get(clientId)
    if (!row) continue
    row.paid += pay.amount
  }

  for (const row of out.values()) {
    row.balance = row.committed - row.paid
  }

  return out
}
