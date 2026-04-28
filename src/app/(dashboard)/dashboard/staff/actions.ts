'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthorizedClinic } from '@/lib/get-clinic'

type Result = { error?: string; success?: boolean }

export async function createStaff(formData: FormData): Promise<Result> {
  const auth = await getAuthorizedClinic()
  if ('error' in auth) return { error: auth.error }
  const { clinicId } = auth

  const name = ((formData.get('name') as string) ?? '').trim()
  const email = ((formData.get('email') as string) ?? '').trim()
  if (!name) return { error: 'Name is required' }
  if (!email) return { error: 'Email is required' }

  const admin = createAdminClient()
  const { error } = await admin.from('staff').insert({
    clinic_id: clinicId,
    name,
    email,
    phone: (formData.get('phone') as string) || null,
    role: (formData.get('role') as 'owner' | 'manager' | 'staff') || 'staff',
    is_active: formData.get('is_active') === 'on',
  })

  if (error) return { error: 'Failed to add staff member' }

  revalidatePath('/dashboard/staff')
  return { success: true }
}

export async function updateStaff(id: string, formData: FormData): Promise<Result> {
  const auth = await getAuthorizedClinic()
  if ('error' in auth) return { error: auth.error }
  const { clinicId } = auth

  const name = ((formData.get('name') as string) ?? '').trim()
  const email = ((formData.get('email') as string) ?? '').trim()
  if (!name) return { error: 'Name is required' }
  if (!email) return { error: 'Email is required' }

  const admin = createAdminClient()
  const { error } = await admin
    .from('staff')
    .update({
      name,
      email,
      phone: (formData.get('phone') as string) || null,
      role: (formData.get('role') as 'owner' | 'manager' | 'staff') || 'staff',
      is_active: formData.get('is_active') === 'on',
    })
    .eq('id', id)
    .eq('clinic_id', clinicId)

  if (error) return { error: 'Failed to update staff member' }

  revalidatePath('/dashboard/staff')
  return { success: true }
}

export async function deleteStaff(id: string): Promise<Result> {
  const auth = await getAuthorizedClinic()
  if ('error' in auth) return { error: auth.error }
  const { clinicId } = auth

  const admin = createAdminClient()
  const { error } = await admin
    .from('staff')
    .delete()
    .eq('id', id)
    .eq('clinic_id', clinicId)

  if (error) return { error: 'Failed to remove staff member' }

  revalidatePath('/dashboard/staff')
  return { success: true }
}
