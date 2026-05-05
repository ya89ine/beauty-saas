'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthorizedClinic } from '@/lib/get-clinic'

type Result = { error?: string; success?: boolean }

export async function createPackage(formData: FormData): Promise<Result> {
  const auth = await getAuthorizedClinic()
  if ('error' in auth) return { error: auth.error }
  const { clinicId } = auth

  const clientId = (formData.get('client_id') as string) ?? ''
  const serviceId = ((formData.get('service_id') as string) ?? '').trim()
  const packageName = ((formData.get('package_name') as string) ?? '').trim()
  const totalPrice = parseFloat(formData.get('total_price') as string) || 0
  const initialPayment = parseFloat(formData.get('initial_payment') as string) || 0
  const totalSessions = parseInt(formData.get('total_sessions') as string) || 1
  const notes = (formData.get('notes') as string) || null

  if (!clientId) return { error: 'Client is required' }
  if (!serviceId) return { error: 'Please select a service for this package' }
  if (!packageName) return { error: 'Package name is required' }
  if (totalSessions < 1) return { error: 'Sessions must be at least 1' }

  const admin = createAdminClient()

  // Verify the client belongs to this clinic
  const { data: clientRow } = await admin
    .from('clients')
    .select('id')
    .eq('id', clientId)
    .eq('clinic_id', clinicId)
    .maybeSingle()
  if (!clientRow) return { error: 'Client not found' }

  // Verify the service belongs to this clinic — appointments derive their
  // service_id from this package, so the link must be authoritative.
  const { data: svcRow } = await admin
    .from('services')
    .select('id')
    .eq('id', serviceId)
    .eq('clinic_id', clinicId)
    .maybeSingle()
  if (!svcRow) return { error: 'Service not found' }

  const { data: pkg, error } = await admin
    .from('treatment_packages')
    .insert({
      clinic_id: clinicId,
      client_id: clientId,
      service_id: serviceId,
      package_name: packageName,
      total_price: totalPrice,
      paid_amount: initialPayment,
      total_sessions: totalSessions,
      notes,
    })
    .select('id')
    .single()

  if (error) return { error: 'Failed to create package' }

  if (initialPayment > 0 && pkg) {
    const method = (formData.get('payment_method') as string) || 'cash'
    await admin.from('package_payments').insert({
      package_id: pkg.id,
      clinic_id: clinicId,
      amount: initialPayment,
      payment_method: method,
      notes: 'Initial payment',
    })
  }

  revalidatePath('/dashboard/packages')
  revalidatePath('/dashboard/revenue')
  return { success: true }
}

export async function updatePackage(id: string, formData: FormData): Promise<Result> {
  const auth = await getAuthorizedClinic()
  if ('error' in auth) return { error: auth.error }
  const { clinicId } = auth

  const serviceId = ((formData.get('service_id') as string) ?? '').trim()
  const packageName = ((formData.get('package_name') as string) ?? '').trim()
  const totalPrice = parseFloat(formData.get('total_price') as string) || 0
  const totalSessions = parseInt(formData.get('total_sessions') as string) || 1
  const notes = (formData.get('notes') as string) || null

  if (!serviceId) return { error: 'Please select a service for this package' }
  if (!packageName) return { error: 'Package name is required' }

  const admin = createAdminClient()

  // Re-validate the service against the clinic — the user could have edited
  // the dropdown HTML or carried over a service that no longer belongs here.
  const { data: svcRow } = await admin
    .from('services')
    .select('id')
    .eq('id', serviceId)
    .eq('clinic_id', clinicId)
    .maybeSingle()
  if (!svcRow) return { error: 'Service not found' }

  const { error } = await admin
    .from('treatment_packages')
    .update({
      service_id: serviceId,
      package_name: packageName,
      total_price: totalPrice,
      total_sessions: totalSessions,
      notes,
    })
    .eq('id', id)
    .eq('clinic_id', clinicId)

  if (error) return { error: 'Failed to update package' }

  revalidatePath('/dashboard/packages')
  revalidatePath('/dashboard/revenue')
  return { success: true }
}

export async function cancelPackage(id: string): Promise<Result> {
  const auth = await getAuthorizedClinic()
  if ('error' in auth) return { error: auth.error }
  const { clinicId } = auth

  const admin = createAdminClient()
  const { error } = await admin
    .from('treatment_packages')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('clinic_id', clinicId)

  if (error) return { error: 'Failed to cancel package' }

  revalidatePath('/dashboard/packages')
  return { success: true }
}

export async function addPackagePayment(packageId: string, formData: FormData): Promise<Result> {
  const auth = await getAuthorizedClinic()
  if ('error' in auth) return { error: auth.error }
  const { clinicId } = auth

  const amount = parseFloat(formData.get('amount') as string)
  const paidAt =
    (formData.get('paid_at') as string) ||
    new Date().toISOString().slice(0, 10)
  const method = (formData.get('payment_method') as string) || 'cash'
  const notes = (formData.get('notes') as string) || null

  if (isNaN(amount) || amount <= 0) return { error: 'Amount must be greater than 0' }

  const admin = createAdminClient()

  // Verify the package belongs to this clinic
  const { data: pkg } = await admin
    .from('treatment_packages')
    .select('id, paid_amount')
    .eq('id', packageId)
    .eq('clinic_id', clinicId)
    .single()

  if (!pkg) return { error: 'Package not found' }

  const { error: payErr } = await admin.from('package_payments').insert({
    package_id: packageId,
    clinic_id: clinicId,
    amount,
    paid_at: paidAt,
    payment_method: method,
    notes,
  })

  if (payErr) return { error: 'Failed to record payment' }

  await admin
    .from('treatment_packages')
    .update({ paid_amount: (pkg.paid_amount ?? 0) + amount })
    .eq('id', packageId)
    .eq('clinic_id', clinicId)

  revalidatePath('/dashboard/packages')
  revalidatePath('/dashboard/revenue')
  return { success: true }
}

export async function manualIncrementSession(packageId: string): Promise<Result> {
  const auth = await getAuthorizedClinic()
  if ('error' in auth) return { error: auth.error }
  const { clinicId } = auth

  const admin = createAdminClient()

  const { data: pkg } = await admin
    .from('treatment_packages')
    .select('completed_sessions, total_sessions')
    .eq('id', packageId)
    .eq('clinic_id', clinicId)
    .single()

  if (!pkg) return { error: 'Package not found' }
  if (pkg.completed_sessions >= pkg.total_sessions)
    return { error: 'All sessions already completed' }

  const newCompleted = pkg.completed_sessions + 1
  const { error } = await admin
    .from('treatment_packages')
    .update({
      completed_sessions: newCompleted,
      status: newCompleted >= pkg.total_sessions ? 'completed' : 'active',
    })
    .eq('id', packageId)
    .eq('clinic_id', clinicId)

  if (error) return { error: 'Failed to update session count' }

  revalidatePath('/dashboard/packages')
  return { success: true }
}
