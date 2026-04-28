import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

type ClinicAuth = { clinicId: string } | { error: string }

/**
 * Verifies the current session and returns the clinic ID owned by the
 * authenticated user. Always call this inside server actions — never trust
 * a clinicId supplied by the client.
 */
export async function getAuthorizedClinic(): Promise<ClinicAuth> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const admin = createAdminClient()
  const { data: clinic } = await admin
    .from('clinics')
    .select('id')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!clinic) return { error: 'No clinic found for this account' }
  return { clinicId: clinic.id }
}
