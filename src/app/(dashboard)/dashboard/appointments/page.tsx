import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AppointmentsClient } from './appointments-client'

export const metadata: Metadata = { title: 'Appointments' }

export default async function AppointmentsPage() {
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
        <h1 className="text-2xl font-semibold tracking-tight">Appointments</h1>
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

  const [
    { data: rawAppointments },
    { data: services },
    { data: staffList },
  ] = await Promise.all([
    admin
      .from('appointments')
      .select('*, service:services(name, duration_minutes), staff:staff(name)')
      .eq('clinic_id', clinic.id)
      .order('starts_at', { ascending: true }),
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

  return (
    <AppointmentsClient
      appointments={appointments}
      services={services ?? []}
      staffList={staffList ?? []}
    />
  )
}
