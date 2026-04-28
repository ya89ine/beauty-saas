'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthorizedClinic } from '@/lib/get-clinic'

export async function updateAppointmentPrice(id: string, price: number | null): Promise<void> {
  const auth = await getAuthorizedClinic()
  if ('error' in auth) return

  const admin = createAdminClient()
  await admin
    .from('appointments')
    .update({ price })
    .eq('id', id)
    .eq('clinic_id', auth.clinicId)

  revalidatePath('/dashboard/revenue')
}

export async function toggleAppointmentPaid(id: string, is_paid: boolean): Promise<void> {
  const auth = await getAuthorizedClinic()
  if ('error' in auth) return

  const admin = createAdminClient()
  await admin
    .from('appointments')
    .update({ is_paid })
    .eq('id', id)
    .eq('clinic_id', auth.clinicId)

  revalidatePath('/dashboard/revenue')
}
