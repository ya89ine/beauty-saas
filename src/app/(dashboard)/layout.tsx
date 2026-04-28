import { unstable_noStore as noStore } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { DashboardShell } from '@/components/dashboard/shell'

export const dynamic = 'force-dynamic'

// Note: this layout lives under app/(dashboard) and only applies to URLs in
// that route group (i.e. /dashboard/*). It can NEVER run for /admin because
// /admin is a separate top-level route segment with its own layout.
// The /admin gate is fully owned by src/proxy.ts.
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  noStore()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Admin client bypasses RLS — auth already verified above via getUser().
  const admin = createAdminClient()
  const { data: clinic, error: clinicError } = await admin
    .from('clinics')
    .select('id, name, slug')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (clinicError) {
    redirect('/onboarding')
  }

  if (!clinic) {
    redirect('/onboarding')
  }

  return (
    <DashboardShell user={user} clinic={clinic ?? null}>
      {children}
    </DashboardShell>
  )
}
