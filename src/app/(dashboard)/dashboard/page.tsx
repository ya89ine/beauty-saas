import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { StatsCards } from '@/components/dashboard/stats-cards'
import { UpcomingAppointments } from '@/components/dashboard/upcoming-appointments'

export const metadata: Metadata = { title: 'Dashboard' }

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const admin = createAdminClient()
  const { data: clinic } = await admin
    .from('clinics')
    .select('id, name')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!clinic) {
    return (
      <div className="flex flex-col items-start gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome</h1>
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

  const now = new Date()
  const startOfDay   = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const endOfDay     = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
  // Monday of current week
  const dow          = now.getDay()
  const startOfWeek  = new Date(startOfDay)
  startOfWeek.setDate(startOfDay.getDate() - (dow === 0 ? 6 : dow - 1))
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const endOfMonth   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)

  type RevenueApt = { starts_at: string; price: number | null; service: { price: number; currency: string } | null }

  const [
    { count: totalClients },
    { count: totalAppointments },
    { count: totalStaff },
    { count: totalServices },
    { data: todayAppointments },
    { count: pendingCount },
    { data: revenueRaw },
  ] = await Promise.all([
    admin
      .from('clients')
      .select('*', { count: 'exact', head: true })
      .eq('clinic_id', clinic.id),
    admin
      .from('appointments')
      .select('*', { count: 'exact', head: true })
      .eq('clinic_id', clinic.id),
    admin
      .from('staff')
      .select('*', { count: 'exact', head: true })
      .eq('clinic_id', clinic.id),
    admin
      .from('services')
      .select('*', { count: 'exact', head: true })
      .eq('clinic_id', clinic.id),
    admin
      .from('appointments')
      .select('id, starts_at, ends_at, status, client_name, service_id')
      .eq('clinic_id', clinic.id)
      .gte('starts_at', startOfDay.toISOString())
      .lte('starts_at', endOfDay.toISOString())
      .order('starts_at')
      .limit(8),
    admin
      .from('appointments')
      .select('*', { count: 'exact', head: true })
      .eq('clinic_id', clinic.id)
      .eq('status', 'pending'),
    // Revenue: this month's non-cancelled/no_show appointments with service price
    admin
      .from('appointments')
      .select('starts_at, price, service:services(price, currency)')
      .eq('clinic_id', clinic.id)
      .gte('starts_at', startOfMonth.toISOString())
      .lte('starts_at', endOfMonth.toISOString())
      .in('status', ['pending', 'confirmed', 'completed']),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const revenueApts = (revenueRaw ?? []) as unknown as RevenueApt[]
  const currency = revenueApts.find((a) => a.service?.currency)?.service?.currency ?? ''

  function sumRevenue(from: Date, to: Date): number {
    return revenueApts
      .filter((a) => {
        const d = new Date(a.starts_at)
        return d >= from && d <= to
      })
      .reduce((sum, a) => sum + (a.price ?? a.service?.price ?? 0), 0)
  }

  const revenueToday     = sumRevenue(startOfDay, endOfDay)
  const revenueThisWeek  = sumRevenue(startOfWeek, endOfDay)
  const revenueThisMonth = sumRevenue(startOfMonth, endOfMonth)

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Good morning 👋
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Here&apos;s what&apos;s happening at {clinic.name} today
        </p>
      </div>

      <StatsCards
        totalClients={totalClients ?? 0}
        totalAppointments={totalAppointments ?? 0}
        totalStaff={totalStaff ?? 0}
        totalServices={totalServices ?? 0}
        todayCount={todayAppointments?.length ?? 0}
        pendingCount={pendingCount ?? 0}
        revenueToday={revenueToday}
        revenueThisWeek={revenueThisWeek}
        revenueThisMonth={revenueThisMonth}
        currency={currency}
      />

      <UpcomingAppointments appointments={todayAppointments ?? []} />
    </div>
  )
}
