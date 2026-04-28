import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { OnboardingForm } from './onboarding-form'
import { Sparkles } from 'lucide-react'

export const metadata: Metadata = { title: 'Set up your clinic' }

export default async function OnboardingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // If clinic already exists, skip onboarding.
  // Uses admin client so RLS cannot block the lookup.
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const admin = createAdminClient()
  const { data: clinic } = await admin
    .from('clinics')
    .select('id')
    .eq('owner_id', user.id)
    .maybeSingle()

  if (clinic) redirect('/dashboard')

  return (
    <div className="bg-surface-gradient flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="mb-8 text-center">
          <div className="mb-4 flex justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary shadow-card">
              <Sparkles className="h-6 w-6 text-primary-foreground" />
            </div>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Set up your beauty center
          </h1>
          <p className="mt-2.5 text-sm text-muted-foreground">
            This takes less than a minute. You can update everything later.
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card/95 p-8 shadow-card backdrop-blur-sm">
          <OnboardingForm />
        </div>
      </div>
    </div>
  )
}
