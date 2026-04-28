'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthorizedClinic } from '@/lib/get-clinic'

type Result = { error?: string; success?: boolean }

export async function createClient_(formData: FormData): Promise<Result> {
  const auth = await getAuthorizedClinic()
  if ('error' in auth) return { error: auth.error }
  const { clinicId } = auth

  const name = ((formData.get('name') as string) ?? '').trim()
  if (!name) return { error: 'Name is required' }

  const admin = createAdminClient()
  const { error } = await admin.from('clients').insert({
    clinic_id: clinicId,
    name,
    email: (formData.get('email') as string) || null,
    phone: (formData.get('phone') as string) || null,
    date_of_birth: (formData.get('date_of_birth') as string) || null,
    notes: (formData.get('notes') as string) || null,
  })

  if (error) return { error: 'Failed to add client' }

  revalidatePath('/dashboard/clients')
  revalidatePath('/dashboard')
  return { success: true }
}

export async function updateClient_(id: string, formData: FormData): Promise<Result> {
  const auth = await getAuthorizedClinic()
  if ('error' in auth) return { error: auth.error }
  const { clinicId } = auth

  const name = ((formData.get('name') as string) ?? '').trim()
  if (!name) return { error: 'Name is required' }

  const admin = createAdminClient()
  const { error } = await admin
    .from('clients')
    .update({
      name,
      email: (formData.get('email') as string) || null,
      phone: (formData.get('phone') as string) || null,
      date_of_birth: (formData.get('date_of_birth') as string) || null,
      notes: (formData.get('notes') as string) || null,
    })
    .eq('id', id)
    .eq('clinic_id', clinicId)

  if (error) return { error: 'Failed to update client' }

  revalidatePath('/dashboard/clients')
  return { success: true }
}

export async function deleteClient_(id: string): Promise<Result> {
  const auth = await getAuthorizedClinic()
  if ('error' in auth) return { error: auth.error }
  const { clinicId } = auth

  const admin = createAdminClient()
  const { error } = await admin
    .from('clients')
    .delete()
    .eq('id', id)
    .eq('clinic_id', clinicId)

  if (error) return { error: 'Failed to delete client' }

  revalidatePath('/dashboard/clients')
  revalidatePath('/dashboard')
  return { success: true }
}
