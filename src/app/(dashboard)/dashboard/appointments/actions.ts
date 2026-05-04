'use server'

import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthorizedClinic } from '@/lib/get-clinic'
import type { Database } from '@/types/database'

type Result = { error?: string; success?: boolean }
type AptStatus = 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show'

// Format a Supabase/PostgREST error into a single human-readable string that's
// safe to surface to the UI. Includes the message plus details/hint when
// present so constraint violations and RLS denials are diagnosable without
// needing the server logs.
function fmtSupabaseError(
  prefix: string,
  err: { message?: string; details?: string | null; hint?: string | null; code?: string | null } | null | undefined,
): string {
  if (!err) return prefix
  const parts = [err.message, err.details, err.hint].filter(Boolean) as string[]
  const body = parts.length > 0 ? parts.join(' — ') : 'unknown error'
  return err.code ? `${prefix}: ${body} (${err.code})` : `${prefix}: ${body}`
}

// Calendar slot granularity. Server-side enforcement of this guarantees that
// drag/snap and direct API edits both keep the schedule on the same grid; the
// overlap check in `findStaffConflict` is exact at minute precision, so any
// off-grid value would silently allow visually-overlapping rows.
const SLOT_MINUTES = 15

function isOnSlot(d: Date): boolean {
  return d.getMinutes() % SLOT_MINUTES === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0
}

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
  if (createErr) {
    console.error('[appointments.resolveClient] insert clients failed', createErr)
    return { error: fmtSupabaseError('Failed to create client', createErr) }
  }
  if (!created) return { error: 'Failed to create client (no row returned)' }
  return { clientId: created.id, name: created.name, email: created.email, phone: created.phone }
}

export async function createAppointment(formData: FormData): Promise<Result> {
  try {
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

    const { data: service, error: serviceErr } = await admin
      .from('services')
      .select('duration_minutes')
      .eq('id', serviceId)
      .eq('clinic_id', clinicId)
      .single()

    if (serviceErr) {
      console.error('[appointments.create] service lookup failed', serviceErr)
      // PostgREST returns code PGRST116 when .single() finds zero rows — that's
      // a "not found" condition, not a real DB failure, so keep the friendlier
      // wording. Anything else (RLS denial, network) surfaces verbatim.
      if (serviceErr.code === 'PGRST116') return { error: 'Service not found' }
      return { error: fmtSupabaseError('Failed to load service', serviceErr) }
    }
    if (!service) return { error: 'Service not found' }

    const duration = parseDuration(formData.get('duration_minutes'), service.duration_minutes)
    if (duration === null) return { error: 'Invalid duration' }
    if (duration % SLOT_MINUTES !== 0) {
      return { error: `Duration must be a multiple of ${SLOT_MINUTES} minutes` }
    }

    const startsAt = new Date(startsAtStr)
    if (isNaN(startsAt.getTime())) return { error: 'Invalid start date/time' }
    if (!isOnSlot(startsAt)) {
      return { error: `Start time must align to a ${SLOT_MINUTES}-minute slot (00, 15, 30, 45)` }
    }
    const endsAt = new Date(startsAt.getTime() + duration * 60_000)

    const staffId = (formData.get('staff_id') as string) || null
    const explicitPackageId = (formData.get('package_id') as string) || null
    const newStatus = ((formData.get('status') as string) || 'pending') as AptStatus

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

    // Auto-link to an active package matching this (client, service) pair so the
    // CRM's session counter stays accurate without a separate "link package"
    // step in the UI. An explicit package_id from the caller still wins.
    const packageId =
      explicitPackageId ?? (await findActivePackageForAppointment(admin, clinicId, resolved.clientId, serviceId))

    // Snapshot the price at booking time so historical revenue stays correct
    // even if the service's price is later edited.
    const { data: serviceFull, error: priceErr } = await admin
      .from('services')
      .select('price')
      .eq('id', serviceId)
      .eq('clinic_id', clinicId)
      .single()
    if (priceErr) {
      console.error('[appointments.create] service price lookup failed', priceErr)
      return { error: fmtSupabaseError('Failed to load service price', priceErr) }
    }

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
      price: serviceFull?.price ?? null,
    })

    if (error) {
      console.error('[appointments.create] insert appointments failed', error)
      return { error: fmtSupabaseError('Failed to create appointment', error) }
    }

    if (newStatus === 'completed' && packageId) {
      await incrementPackageSessions(admin, packageId)
    }

    revalidatePath('/dashboard/appointments')
    revalidatePath('/dashboard/packages')
    revalidatePath('/dashboard/clients')
    revalidatePath('/dashboard')
    return { success: true }
  } catch (e) {
    console.error('[appointments.create] unexpected error', e)
    const msg = e instanceof Error ? e.message : String(e)
    return { error: `Failed to create appointment: ${msg}` }
  }
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
    .select('status, package_id, client_id, service_id')
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
  if (duration % SLOT_MINUTES !== 0) {
    return { error: `Duration must be a multiple of ${SLOT_MINUTES} minutes` }
  }

  const startsAt = new Date(startsAtStr)
  if (isNaN(startsAt.getTime())) return { error: 'Invalid start date/time' }
  if (!isOnSlot(startsAt)) {
    return { error: `Start time must align to a ${SLOT_MINUTES}-minute slot (00, 15, 30, 45)` }
  }
  const endsAt = new Date(startsAt.getTime() + duration * 60_000)

  const staffId = (formData.get('staff_id') as string) || null
  const explicitPackageId = (formData.get('package_id') as string) || null
  const newStatus = ((formData.get('status') as string) || 'pending') as AptStatus

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

  // Re-evaluate the package link if (a) the client/service changed (existing
  // link may no longer apply) or (b) there's no link yet. An explicit
  // package_id from the caller still wins. Keeping the same package on a
  // simple time/staff edit avoids re-querying for unchanged rows.
  const clientServiceChanged =
    resolved.clientId !== currentApt.client_id || serviceId !== currentApt.service_id
  let packageId = explicitPackageId ?? currentApt.package_id
  if (!explicitPackageId && (clientServiceChanged || !currentApt.package_id)) {
    packageId =
      (await findActivePackageForAppointment(admin, clinicId, resolved.clientId, serviceId)) ??
      currentApt.package_id
  }

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

  // Session counter sync. Three transitions matter:
  //   • non-completed → completed: increment new package
  //   • completed → non-completed: decrement old package (it was credited
  //     before, so keep the counter honest)
  //   • completed → completed but package_id changed: move the credit
  const wasCompleted = currentApt.status === 'completed'
  const isCompleted = newStatus === 'completed'
  if (!wasCompleted && isCompleted && packageId) {
    await incrementPackageSessions(admin, packageId)
  } else if (wasCompleted && !isCompleted && currentApt.package_id) {
    await decrementPackageSessions(admin, currentApt.package_id)
  } else if (
    wasCompleted &&
    isCompleted &&
    currentApt.package_id !== packageId
  ) {
    if (currentApt.package_id) await decrementPackageSessions(admin, currentApt.package_id)
    if (packageId) await incrementPackageSessions(admin, packageId)
  }

  revalidatePath('/dashboard/appointments')
  revalidatePath('/dashboard/packages')
  revalidatePath('/dashboard/clients')
  revalidatePath('/dashboard')
  return { success: true }
}

export async function deleteAppointment(id: string): Promise<Result> {
  const auth = await getAuthorizedClinic()
  if ('error' in auth) return { error: auth.error }
  const { clinicId } = auth

  const admin = createAdminClient()

  // Read first so we can reverse any package credit the appointment held.
  const { data: existing } = await admin
    .from('appointments')
    .select('status, package_id')
    .eq('id', id)
    .eq('clinic_id', clinicId)
    .maybeSingle()

  const { error } = await admin
    .from('appointments')
    .delete()
    .eq('id', id)
    .eq('clinic_id', clinicId)

  if (error) return { error: 'Failed to delete appointment' }

  if (existing?.status === 'completed' && existing.package_id) {
    await decrementPackageSessions(admin, existing.package_id)
  }

  revalidatePath('/dashboard/appointments')
  revalidatePath('/dashboard/packages')
  revalidatePath('/dashboard/clients')
  revalidatePath('/dashboard')
  return { success: true }
}

async function incrementPackageSessions(
  admin: SupabaseClient<Database>,
  packageId: string,
) {
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

// Reverse counterpart: when an appointment moves OUT of 'completed' (e.g. the
// owner re-opens it), credit the session back so the package's totals stay
// truthful. Floor at 0 — cancelled packages or partial inserts shouldn't go
// negative.
async function decrementPackageSessions(
  admin: SupabaseClient<Database>,
  packageId: string,
) {
  const { data: pkg } = await admin
    .from('treatment_packages')
    .select('completed_sessions, total_sessions')
    .eq('id', packageId)
    .single()

  if (!pkg) return

  const newCompleted = Math.max(0, pkg.completed_sessions - 1)
  await admin
    .from('treatment_packages')
    .update({
      completed_sessions: newCompleted,
      // If we previously hit "completed" status purely because counters tipped
      // over, drop back to 'active' so the package stays usable.
      status: newCompleted >= pkg.total_sessions ? 'completed' : 'active',
    })
    .eq('id', packageId)
}

// Find a still-active package the appointment can attach to: same client,
// same service, sessions remaining. Used when the form/import doesn't supply
// an explicit package_id — we'd rather attach automatically than silently
// drop the link to billing.
async function findActivePackageForAppointment(
  admin: SupabaseClient<Database>,
  clinicId: string,
  clientId: string,
  serviceId: string,
): Promise<string | null> {
  const { data } = await admin
    .from('treatment_packages')
    .select('id, total_sessions, completed_sessions')
    .eq('clinic_id', clinicId)
    .eq('client_id', clientId)
    .eq('service_id', serviceId)
    .eq('status', 'active')
    .order('created_at', { ascending: true })

  if (!data || data.length === 0) return null
  // Pick the oldest active package that still has remaining sessions, falling
  // back to the first active row so we don't silently drop the link if every
  // package is full (the service-action will surface the issue elsewhere).
  const withRemaining = data.find((p) => p.completed_sessions < p.total_sessions)
  return (withRemaining ?? data[0]).id
}

// ─── Auto-complete past appointments ─────────────────────────────────────────
//
// Runs at page render time. Any appointment whose `ends_at` has elapsed and is
// still 'pending' or 'confirmed' is bulk-promoted to 'completed', and any
// linked package gets its session counter bumped. Idempotent: appointments
// already in a terminal status are skipped.
//
// We do this in the render path (not a cron) because the SaaS doesn't run a
// background worker — calling it here means the calendar always reflects an
// up-to-date view the moment a clinic owner opens the app.
export async function autoCompletePastAppointments(clinicId: string): Promise<{
  completed: number
}> {
  const admin = createAdminClient()
  const nowIso = new Date().toISOString()

  const { data: stale } = await admin
    .from('appointments')
    .select('id, package_id, status')
    .eq('clinic_id', clinicId)
    .in('status', ['pending', 'confirmed'])
    .lt('ends_at', nowIso)

  if (!stale || stale.length === 0) return { completed: 0 }

  const ids = stale.map((a) => a.id)
  const { error } = await admin
    .from('appointments')
    .update({ status: 'completed' satisfies AptStatus })
    .in('id', ids)

  if (error) return { completed: 0 }

  // Bump linked packages — sequentially to keep the counter race-free for the
  // same package. `incrementPackageSessions` uses read-modify-write, so doing
  // these in parallel for two appointments on the same package would race.
  for (const apt of stale) {
    if (apt.package_id) {
      await incrementPackageSessions(admin, apt.package_id)
    }
  }

  return { completed: stale.length }
}
