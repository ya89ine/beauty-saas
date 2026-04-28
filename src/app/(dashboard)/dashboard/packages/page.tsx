import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PackagesClient } from './packages-client'

export const metadata: Metadata = { title: 'Treatment Packages' }

export default async function PackagesPage() {
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
        <h1 className="text-3xl font-semibold tracking-tight">
          Treatment Packages
        </h1>
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
    { data: rawPackages },
    { data: clients },
    { data: services },
    { data: rawPayments },
  ] = await Promise.all([
    admin
      .from('treatment_packages')
      .select('*, client:clients(id, name, phone), service:services(name)')
      .eq('clinic_id', clinic.id)
      .order('created_at', { ascending: false }),
    admin
      .from('clients')
      .select('id, name, phone')
      .eq('clinic_id', clinic.id)
      .order('name'),
    admin
      .from('services')
      .select('id, name')
      .eq('clinic_id', clinic.id)
      .eq('is_active', true)
      .order('name'),
    admin
      .from('package_payments')
      .select('*')
      .eq('clinic_id', clinic.id)
      .order('paid_at', { ascending: false }),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const packages = (rawPackages ?? []) as any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payments = (rawPayments ?? []) as any[]

  return (
    <PackagesClient
      packages={packages}
      clients={clients ?? []}
      services={services ?? []}
      payments={payments}
    />
  )
}
