'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthorizedClinic } from '@/lib/get-clinic'

type Result = { error?: string; success?: boolean }

export async function createAppointment(formData: FormData): Promise<Result> {
  const auth = await getAuthorizedClinic()
  if ('error' in auth) return { error: auth.error }
  const { clinicId } = auth

  const clientName = ((formData.get('client_name') as string) ?? '').trim()
  const serviceId = (formData.get('service_id') as string) ?? ''
  const startsAtStr = (formData.get('starts_at') as string) ?? ''

  if (!clientName) return { error: 'Client name is required' }
  if (!serviceId) return { error: 'Service is required' }
  if (!startsAtStr) return { error: 'Start date/time is required' }

  const admin = createAdminClient()

  const { data: service } = await admin
    .from('services')
    .select('duration_minutes')
    .eq('id', serviceId)
    .eq('clinic_id', clinicId)
    .single()

  if (!service) return { error: 'Service not found' }

  const startsAt = new Date(startsAtStr)
  const endsAt = new Date(startsAt.getTime() + service.duration_minutes * 60_000)

  const staffId = (formData.get('staff_id') as string) || null
  const packageId = (formData.get('package_id') as string) || null
  const newStatus = ((formData.get('status') as string) || 'pending') as
    | 'pending'
    | 'confirmed'
    | 'cancelled'
    | 'completed'
    | 'no_show'

  const { error } = await admin.from('appointments').insert({
    clinic_id: clinicId,
    client_name: clientName,
    client_email: (formData.get('client_email') as string) || null,
    client_phone: (formData.get('client_phone') as string) || null,
    service_id: serviceId,
    staff_id: staffId,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    status: newStatus,
    notes: (formData.get('notes') as string) || null,
    package_id: packageId,
  })

  if (error) return { error: 'Failed to create appointment' }

  if (newStatus === 'completed' && packageId) {
    await incrementPackageSessions(admin, packageId)
  }

  revalidatePath('/dashboard/appointments')
  revalidatePath('/dashboard/packages')
  revalidatePath('/dashboard')
  return { success: true }
}

export async function updateAppointment(id: string, formData: FormData): Promise<Result> {
  const auth = await getAuthorizedClinic()
  if ('error' in auth) return { error: auth.error }
  const { clinicId } = auth

  const clientName = ((formData.get('client_name') as string) ?? '').trim()
  const serviceId = (formData.get('service_id') as string) ?? ''
  const startsAtStr = (formData.get('starts_at') as string) ?? ''

  if (!clientName) return { error: 'Client name is required' }
  if (!serviceId) return { error: 'Service is required' }
  if (!startsAtStr) return { error: 'Start date/time is required' }

  const admin = createAdminClient()

  const { data: currentApt } = await admin
    .from('appointments')
    .select('status, package_id')
    .eq('id', id)
    .eq('clinic_id', clinicId)
    .single()

  if (!currentApt) return { error: 'Appointment not found' }

  const { data: service } = await admin
    .from('services')
    .select('duration_minutes')
    .eq('id', serviceId)
    .eq('clinic_id', clinicId)
    .single()

  if (!service) return { error: 'Service not found' }

  const startsAt = new Date(startsAtStr)
  const endsAt = new Date(startsAt.getTime() + service.duration_minutes * 60_000)

  const staffId = (formData.get('staff_id') as string) || null
  const packageId = (formData.get('package_id') as string) || null
  const newStatus = ((formData.get('status') as string) || 'pending') as
    | 'pending'
    | 'confirmed'
    | 'cancelled'
    | 'completed'
    | 'no_show'

  const { error } = await admin
    .from('appointments')
    .update({
      client_name: clientName,
      client_email: (formData.get('client_email') as string) || null,
      client_phone: (formData.get('client_phone') as string) || null,
      service_id: serviceId,
      staff_id: staffId,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      status: newStatus,
      notes: (formData.get('notes') as string) || null,
      package_id: packageId,
    })
    .eq('id', id)
    .eq('clinic_id', clinicId)

  if (error) return { error: 'Failed to update appointment' }

  const effectivePackageId = packageId ?? currentApt.package_id
  if (
    effectivePackageId &&
    newStatus === 'completed' &&
    currentApt.status !== 'completed'
  ) {
    await incrementPackageSessions(admin, effectivePackageId)
  }

  revalidatePath('/dashboard/appointments')
  revalidatePath('/dashboard/packages')
  revalidatePath('/dashboard')
  return { success: true }
}

export async function deleteAppointment(id: string): Promise<Result> {
  const auth = await getAuthorizedClinic()
  if ('error' in auth) return { error: auth.error }
  const { clinicId } = auth

  const admin = createAdminClient()
  const { error } = await admin
    .from('appointments')
    .delete()
    .eq('id', id)
    .eq('clinic_id', clinicId)

  if (error) return { error: 'Failed to delete appointment' }

  revalidatePath('/dashboard/appointments')
  revalidatePath('/dashboard')
  return { success: true }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function incrementPackageSessions(admin: any, packageId: string) {
  const { data: pkg } = await admin
    .from('treatment_packages')
    .select('completed_sessions, total_sessions')
    .eq('id', packageId)
    .single()

  if (!pkg) return

  const newCompleted = pkg.completed_sessions + 1
  await admin
    .from('treatment_packages')
    .update({
      completed_sessions: newCompleted,
      status: newCompleted >= pkg.total_sessions ? 'completed' : 'active',
    })
    .eq('id', packageId)
}
