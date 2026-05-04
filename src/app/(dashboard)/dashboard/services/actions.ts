'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthorizedClinic } from '@/lib/get-clinic'

type Result = { error?: string; success?: boolean }

// Accept the 7-char hex (`#RRGGBB`) the picker submits; reject anything else
// rather than persisting bogus CSS. Empty/null clears the override so the
// fallback palette resolver in `lib/service-colors` takes over again.
function parseColor(raw: FormDataEntryValue | null): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim()
  if (!v) return null
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toUpperCase() : null
}

export async function createService(formData: FormData): Promise<Result> {
  const auth = await getAuthorizedClinic()
  if ('error' in auth) return { error: auth.error }
  const { clinicId } = auth

  const name = ((formData.get('name') as string | null) ?? '').trim()
  if (!name) return { error: 'Name is required' }

  const duration = parseInt(formData.get('duration_minutes') as string, 10)
  const price = parseFloat(formData.get('price') as string)

  if (!duration || duration <= 0) return { error: 'Duration must be greater than 0' }
  if (isNaN(price) || price < 0) return { error: 'Price must be 0 or greater' }

  const admin = createAdminClient()
  const { error } = await admin.from('services').insert({
    clinic_id: clinicId,
    name,
    description: (formData.get('description') as string | null) || null,
    duration_minutes: duration,
    price,
    currency: 'MAD',
    category: (formData.get('category') as string | null) || null,
    color: parseColor(formData.get('color')),
    is_active: formData.get('is_active') === 'on',
  })

  if (error) return { error: 'Failed to create service' }

  revalidatePath('/dashboard/services')
  return { success: true }
}

export async function updateService(id: string, formData: FormData): Promise<Result> {
  const auth = await getAuthorizedClinic()
  if ('error' in auth) return { error: auth.error }
  const { clinicId } = auth

  const name = ((formData.get('name') as string | null) ?? '').trim()
  if (!name) return { error: 'Name is required' }

  const duration = parseInt(formData.get('duration_minutes') as string, 10)
  const price = parseFloat(formData.get('price') as string)

  if (!duration || duration <= 0) return { error: 'Duration must be greater than 0' }
  if (isNaN(price) || price < 0) return { error: 'Price must be 0 or greater' }

  const admin = createAdminClient()
  const { error } = await admin
    .from('services')
    .update({
      name,
      description: (formData.get('description') as string | null) || null,
      duration_minutes: duration,
      price,
      category: (formData.get('category') as string | null) || null,
      color: parseColor(formData.get('color')),
      is_active: formData.get('is_active') === 'on',
    })
    .eq('id', id)
    .eq('clinic_id', clinicId)

  if (error) return { error: 'Failed to update service' }

  revalidatePath('/dashboard/services')
  return { success: true }
}

export async function deleteService(id: string): Promise<Result> {
  const auth = await getAuthorizedClinic()
  if ('error' in auth) return { error: auth.error }
  const { clinicId } = auth

  const admin = createAdminClient()
  const { error } = await admin
    .from('services')
    .delete()
    .eq('id', id)
    .eq('clinic_id', clinicId)

  if (error) return { error: 'Failed to delete service' }

  revalidatePath('/dashboard/services')
  return { success: true }
}
