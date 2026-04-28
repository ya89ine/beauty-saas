'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthorizedClinic } from '@/lib/get-clinic'

type Result = { error?: string; success?: boolean }

export async function updateClinic(
  _ignoredClinicId: string,
  formData: FormData
): Promise<Result> {
  // Always derive clinicId server-side — never trust the client-supplied ID.
  const auth = await getAuthorizedClinic()
  if ('error' in auth) return { error: auth.error }
  const { clinicId } = auth

  const name = ((formData.get('name') as string) ?? '').trim()
  if (!name) return { error: 'Clinic name is required' }

  const admin = createAdminClient()
  const { error } = await admin
    .from('clinics')
    .update({
      name,
      email: (formData.get('email') as string) || null,
      phone: (formData.get('phone') as string) || null,
      address: (formData.get('address') as string) || null,
      timezone: (formData.get('timezone') as string) || 'UTC',
      booking_enabled: formData.get('booking_enabled') === 'on',
    })
    .eq('id', clinicId)

  if (error) return { error: error.message }

  revalidatePath('/dashboard/settings')
  revalidatePath('/dashboard', 'layout')
  return { success: true }
}
