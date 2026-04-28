import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { StaffPerformanceClient } from './staff-performance-client'

export const metadata: Metadata = { title: 'Staff Performance' }

export default async function StaffPerformancePage() {
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
        <h1 className="text-2xl font-semibold tracking-tight">Staff Performance</h1>
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

  const [{ data: rawStaff }, { data: rawApts }] = await Promise.all([
    admin
      .from('staff')
      .select('id, name, role')
      .eq('clinic_id', clinic.id)
      .eq('is_active', true)
      .order('name'),
    admin
      .from('appointments')
      .select('id, starts_at, status, staff_id, client_id, client_email, client_name, service:services(price)')
      .eq('clinic_id', clinic.id)
      .eq('status', 'completed'),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (
    <StaffPerformanceClient
      staffList={rawStaff ?? []}
      appointments={(rawApts ?? []) as any[]}
    />
  )
}
