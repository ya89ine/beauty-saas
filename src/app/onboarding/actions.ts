'use server'

import { createClient } from '@/lib/supabase/server'

export async function createClinic(
  _prev: unknown,
  formData: FormData
): Promise<{ error?: string; success?: boolean }> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { error: 'Not authenticated' }

  const name = (formData.get('name') as string).trim()
  const slug = (formData.get('slug') as string).trim().toLowerCase()
  const email = (formData.get('email') as string | null) || null
  const phone = (formData.get('phone') as string | null) || null

  if (!name || !slug) return { error: 'Name and slug are required' }
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return { error: 'Slug must contain only lowercase letters, numbers, and hyphens' }
  }

  const { error } = await supabase.rpc('create_clinic_with_owner', {
    p_name: name,
    p_slug: slug,
    p_email: email,
    p_phone: phone,
  })

  if (error) {
    if (error.code === '23505') return { error: 'That URL slug is already taken' }
    return { error: error.message }
  }

  return { success: true }
}
