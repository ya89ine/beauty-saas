'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAdminEmail } from '@/lib/admin'

type Result = { error?: string; success?: boolean }

export async function createClinic(formData: FormData): Promise<Result> {
  const check = await verifyAdmin()
  if ('error' in check) return { error: check.error }

  const name       = ((formData.get('name')       as string) ?? '').trim()
  const slug       = ((formData.get('slug')       as string) ?? '').trim().toLowerCase()
  const ownerEmail = ((formData.get('ownerEmail') as string) ?? '').trim().toLowerCase()
  const ownerName  = ((formData.get('ownerName')  as string) ?? '').trim()
  const password   = ((formData.get('password')   as string) ?? '')
  const status     = ((formData.get('status')     as string) ?? 'trial') as 'trial' | 'active' | 'paused'

  if (!name)       return { error: 'Clinic name is required' }
  if (!slug)       return { error: 'Slug is required' }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return { error: 'Slug must be lowercase letters, numbers and hyphens only' }
  if (!ownerEmail) return { error: 'Owner email is required' }
  if (!ownerName)  return { error: 'Owner name is required' }
  if (password.length < 8) return { error: 'Password must be at least 8 characters' }

  const admin = createAdminClient()

  // Check slug uniqueness
  const { data: existing } = await admin.from('clinics').select('id').eq('slug', slug).maybeSingle()
  if (existing) return { error: `Slug "${slug}" is already taken` }

  // 1. Create Supabase Auth user
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: ownerEmail,
    password,
    email_confirm: true,
    user_metadata: { full_name: ownerName },
  })
  if (authError) return { error: authError.message }
  const ownerId = authData.user.id

  // 2. Create clinic
  const { data: clinic, error: clinicError } = await admin
    .from('clinics')
    .insert({ name, slug, owner_id: ownerId, subscription_status: status })
    .select('id')
    .single()

  if (clinicError) {
    await admin.auth.admin.deleteUser(ownerId)
    return { error: 'Failed to create clinic: ' + clinicError.message }
  }

  // 3. Create staff row for the owner
  const { error: staffError } = await admin.from('staff').insert({
    clinic_id: clinic.id,
    name: ownerName,
    email: ownerEmail,
    role: 'owner',
    is_active: true,
  })

  if (staffError) {
    // Non-fatal: clinic + user exist; staff row can be added later
    revalidatePath('/admin')
    return { success: true }
  }

  revalidatePath('/admin')
  return { success: true }
}

async function verifyAdmin(): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || !isAdminEmail(user.email)) return { error: 'Unauthorized' }
  return { ok: true }
}

export async function setClinicStatus(
  clinicId: string,
  status: 'trial' | 'active' | 'paused',
): Promise<Result> {
  const check = await verifyAdmin()
  if ('error' in check) return { error: check.error }

  const admin = createAdminClient()
  const { error } = await admin
    .from('clinics')
    .update({ subscription_status: status })
    .eq('id', clinicId)

  if (error) return { error: 'Failed to update status' }

  revalidatePath('/admin')
  return { success: true }
}

export async function saveClinicNotes(
  clinicId: string,
  notes: string,
): Promise<Result> {
  const check = await verifyAdmin()
  if ('error' in check) return { error: check.error }

  const admin = createAdminClient()
  const { error } = await admin
    .from('clinics')
    .update({ admin_notes: notes.trim() || null })
    .eq('id', clinicId)

  if (error) return { error: 'Failed to save notes' }

  revalidatePath('/admin')
  return { success: true }
}

export async function extendTrial(
  clinicId: string,
  days: number,
): Promise<Result> {
  const check = await verifyAdmin()
  if ('error' in check) return { error: check.error }

  if (![3, 7, 14, 30].includes(days)) return { error: 'Invalid extension length' }

  const admin = createAdminClient()

  // Read current trial_ends_at to compute new end (extend from current end if in future, else from now)
  const { data: clinic, error: readErr } = await admin
    .from('clinics')
    .select('trial_ends_at')
    .eq('id', clinicId)
    .maybeSingle()

  if (readErr || !clinic) return { error: 'Clinic not found' }

  const now = new Date()
  const currentEnd = clinic.trial_ends_at ? new Date(clinic.trial_ends_at) : null
  const base = currentEnd && currentEnd > now ? currentEnd : now
  const next = new Date(base.getTime() + days * 86_400_000)

  const { error } = await admin
    .from('clinics')
    .update({
      subscription_status: 'trial',
      trial_ends_at: next.toISOString(),
    })
    .eq('id', clinicId)

  if (error) return { error: 'Failed to extend trial' }

  revalidatePath('/admin')
  return { success: true }
}

export async function saveClinicBilling(
  clinicId: string,
  monthlyPrice: number | null,
  billingNotes: string,
): Promise<Result> {
  const check = await verifyAdmin()
  if ('error' in check) return { error: check.error }

  const admin = createAdminClient()
  const { error } = await admin
    .from('clinics')
    .update({
      monthly_price: monthlyPrice,
      billing_notes: billingNotes.trim() || null,
    })
    .eq('id', clinicId)

  if (error) return { error: 'Failed to save billing info' }

  revalidatePath('/admin')
  return { success: true }
}
