'use server'

import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthorizedClinic } from '@/lib/get-clinic'
import type { Database } from '@/types/database'

type Result = { error?: string; success?: boolean }

export type ClientSummary = {
  id: string
  name: string
  email: string | null
  phone: string | null
}

// The dropdown limits the user to APPOINTMENT_DURATIONS, but the server is
// intentionally lenient: drag-reschedules and legacy rows may carry durations
// outside the dropdown set. Accept any positive integer up to 24h.
function parseDuration(raw: unknown, fallbackFromService: number): number | null {
  if (raw === null || raw === undefined || raw === '') return fallbackFromService
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null
  if (n < 1 || n > 1440) return null
  return n
}

// Returns the first conflicting appointment for the given staff member in
// `[startsAt, endsAt)`, or null if the slot is free. Two ranges overlap when
// existing.starts_at < new.ends_at AND existing.ends_at > new.starts_at.
// Cancelled appointments do not block the slot. When updating an existing
// appointment, pass its id to `excludeId` so it doesn't conflict with itself.
async function findStaffConflict(
  admin: SupabaseClient<Database>,
  clinicId: string,
  staffId: string,
  startsAtIso: string,
  endsAtIso: string,
  excludeId: string | null,
): Promise<{ id: string; client_name: string; starts_at: string; ends_at: string } | null> {
  let q = admin
    .from('appointments')
    .select('id, client_name, starts_at, ends_at')
    .eq('clinic_id', clinicId)
    .eq('staff_id', staffId)
    .neq('status', 'cancelled')
    .lt('starts_at', endsAtIso)
    .gt('ends_at', startsAtIso)
    .limit(1)
  if (excludeId) q = q.neq('id', excludeId)
  const { data } = await q
  return data && data.length > 0 ? data[0] : null
}

function formatConflict(c: { client_name: string; starts_at: string; ends_at: string }): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return `Time slot overlaps with ${c.client_name} (${fmt(c.starts_at)}–${fmt(c.ends_at)})`
}

// ─── Smart client lookup ─────────────────────────────────────────────────────
//
// Searches the clinic's `clients` table by name / email / phone (case-insensitive
// substring). Returns up to 10 results. Used by the appointment-form combobox.
export async function searchClients(query: string): Promise<{
  error?: string
  clients?: ClientSummary[]
}> {
  const auth = await getAuthorizedClinic()
  if ('error' in auth) return { error: auth.error }

  // Strip PostgREST `or` separators and ilike wildcards so user input cannot
  // break the filter string. Also bail on empty queries.
  const safe = query.replace(/[*(),"]/g, ' ').trim()
  if (!safe) return { clients: [] }

  const admin = createAdminClient()
  const filter = `name.ilike.*${safe}*,email.ilike.*${safe}*,phone.ilike.*${safe}*`
  const { data, error } = await admin
    .from('clients')
    .select('id, name, email, phone')
    .eq('clinic_id', auth.clinicId)
    .or(filter)
    .order('name')
    .limit(10)

  if (error) return { error: 'Search failed' }
  return { clients: data ?? [] }
}

// ─── Resolve appointment → client link ───────────────────────────────────────
//
// Three paths, in order of preference:
//   1. Caller passed an explicit client_id (selected in the combobox) →
//      verify it belongs to this clinic, and pull authoritative name/email/phone
//      from the client record so the appointment stays in sync.
//   2. No client_id but a contact identifier (phone or email) was supplied →
//      look up an existing client by exact match. If found, reuse it (this is
//      the "prevent duplicate contacts" rule). Update its name if blank.
//   3. Otherwise → create a new client and use that id.
//
// Returns the resolved id and the canonical name/email/phone to denormalize
// onto the appointments row.
async function resolveClientForAppointment(
  admin: SupabaseClient<Database>,
  clinicId: string,
  input: {
    clientIdRaw: string
    name: string
    email: string | null
    phone: string | null
  },
): Promise<
  | { error: string }
  | { clientId: string; name: string; email: string | null; phone: string | null }
> {
  const { clientIdRaw, name } = input
  const email = input.email?.trim().toLowerCase() || null
  const phone = input.phone?.trim() || null

  // Path 1: explicit selection
  if (clientIdRaw) {
    const { data: existing } = await admin
      .from('clients')
      .select('id, name, email, phone')
      .eq('id', clientIdRaw)
      .eq('clinic_id', clinicId)
      .maybeSingle()
    if (!existing) return { error: 'Selected client no longer exists' }
    return { clientId: existing.id, name: existing.name, email: existing.email, phone: existing.phone }
  }

  if (!name) return { error: 'Client name is required' }

  // Path 2: dedup by contact
  if (phone || email) {
    const orParts: string[] = []
    if (phone) orParts.push(`phone.eq.${phone.replace(/[*(),"]/g, '')}`)
    if (email) orParts.push(`email.eq.${email.replace(/[*(),"]/g, '')}`)
    if (orParts.length > 0) {
      const { data: matches } = await admin
        .from('clients')
        .select('id, name, email, phone')
        .eq('clinic_id', clinicId)
        .or(orParts.join(','))
        .limit(1)
      if (matches && matches.length > 0) {
        return { clientId: matches[0].id, name: matches[0].name, email: matches[0].email, phone: matches[0].phone }
      }
    }
  }

  // Path 3: create new client
  const { data: created, error: createErr } = await admin
    .from('clients')
    .insert({ clinic_id: clinicId, name, email, phone })
    .select('id, name, email, phone')
    .single()
  if (createErr || !created) return { error: 'Failed to create client' }
  return { clientId: created.id, name: created.name, email: created.email, phone: created.phone }
}

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

  const duration = parseDuration(formData.get('duration_minutes'), service.duration_minutes)
  if (duration === null) return { error: 'Invalid duration' }

  const startsAt = new Date(startsAtStr)
  const endsAt = new Date(startsAt.getTime() + duration * 60_000)

  const staffId = (formData.get('staff_id') as string) || null
  const packageId = (formData.get('package_id') as string) || null
  const newStatus = ((formData.get('status') as string) || 'pending') as
    | 'pending'
    | 'confirmed'
    | 'cancelled'
    | 'completed'
    | 'no_show'

  // Overlap check: only enforced when a staff member is assigned and the new
  // appointment is not itself cancelled.
  if (staffId && newStatus !== 'cancelled') {
    const conflict = await findStaffConflict(admin, clinicId, staffId, startsAt.toISOString(), endsAt.toISOString(), null)
    if (conflict) return { error: formatConflict(conflict) }
  }

  const resolved = await resolveClientForAppointment(admin, clinicId, {
    clientIdRaw: ((formData.get('client_id') as string) ?? '').trim(),
    name: clientName,
    email: ((formData.get('client_email') as string) ?? '').trim() || null,
    phone: ((formData.get('client_phone') as string) ?? '').trim() || null,
  })
  if ('error' in resolved) return { error: resolved.error }

  const { error } = await admin.from('appointments').insert({
    clinic_id: clinicId,
    client_id: resolved.clientId,
    client_name: resolved.name,
    client_email: resolved.email,
    client_phone: resolved.phone,
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

  const duration = parseDuration(formData.get('duration_minutes'), service.duration_minutes)
  if (duration === null) return { error: 'Invalid duration' }

  const startsAt = new Date(startsAtStr)
  const endsAt = new Date(startsAt.getTime() + duration * 60_000)

  const staffId = (formData.get('staff_id') as string) || null
  const packageId = (formData.get('package_id') as string) || null
  const newStatus = ((formData.get('status') as string) || 'pending') as
    | 'pending'
    | 'confirmed'
    | 'cancelled'
    | 'completed'
    | 'no_show'

  if (staffId && newStatus !== 'cancelled') {
    const conflict = await findStaffConflict(admin, clinicId, staffId, startsAt.toISOString(), endsAt.toISOString(), id)
    if (conflict) return { error: formatConflict(conflict) }
  }

  const resolved = await resolveClientForAppointment(admin, clinicId, {
    clientIdRaw: ((formData.get('client_id') as string) ?? '').trim(),
    name: clientName,
    email: ((formData.get('client_email') as string) ?? '').trim() || null,
    phone: ((formData.get('client_phone') as string) ?? '').trim() || null,
  })
  if ('error' in resolved) return { error: resolved.error }

  const { error } = await admin
    .from('appointments')
    .update({
      client_id: resolved.clientId,
      client_name: resolved.name,
      client_email: resolved.email,
      client_phone: resolved.phone,
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
