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

// ─── Active-package query for the appointment form ───────────────────────────
//
// The appointment form uses this to populate the package dropdown after the
// user picks a client. Only `active` packages with a service attached are
// returned — the appointment requires a `service_id`, which it derives from
// the package.
export type ActivePackage = {
  id: string
  package_name: string
  service_id: string | null
  service_name: string | null
  service_duration_minutes: number | null
  total_sessions: number
  completed_sessions: number
  total_price: number
  paid_amount: number
}

export async function getClientActivePackages(clientId: string): Promise<{
  error?: string
  packages?: ActivePackage[]
}> {
  const auth = await getAuthorizedClinic()
  if ('error' in auth) return { error: auth.error }
  const { clinicId } = auth

  const admin = createAdminClient()
  const { data: pkgs, error } = await admin
    .from('treatment_packages')
    .select('id, package_name, service_id, total_sessions, completed_sessions, total_price, paid_amount')
    .eq('clinic_id', clinicId)
    .eq('client_id', clientId)
    .eq('status', 'active')
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[appointments.getClientActivePackages] failed', error)
    return { error: fmtSupabaseError('Failed to load packages', error) }
  }

  // Generated Supabase types don't model the packages→services FK, so PostgREST
  // embeds fail typechecking. Two queries keep the types honest at the cost of
  // one extra round-trip — small fixed-cost since we already filter to one
  // client's active packages.
  const serviceIds = Array.from(
    new Set(
      (pkgs ?? []).map((p) => p.service_id).filter((s): s is string => !!s),
    ),
  )
  const serviceMap = new Map<string, { name: string; duration_minutes: number }>()
  if (serviceIds.length > 0) {
    const { data: svcs } = await admin
      .from('services')
      .select('id, name, duration_minutes')
      .in('id', serviceIds)
    for (const s of svcs ?? []) {
      serviceMap.set(s.id, { name: s.name, duration_minutes: s.duration_minutes })
    }
  }

  const packages: ActivePackage[] = (pkgs ?? []).map((p) => {
    const svc = p.service_id ? serviceMap.get(p.service_id) : null
    return {
      id: p.id,
      package_name: p.package_name,
      service_id: p.service_id,
      service_name: svc?.name ?? null,
      service_duration_minutes: svc?.duration_minutes ?? null,
      total_sessions: p.total_sessions,
      completed_sessions: p.completed_sessions,
      total_price: p.total_price,
      paid_amount: p.paid_amount,
    }
  })
  return { packages }
}

// Validate a package belongs to this clinic + client and is currently active.
// Returns the resolved row (with service_id) or an error string.
async function loadActivePackage(
  admin: SupabaseClient<Database>,
  clinicId: string,
  packageId: string,
  expectedClientId: string,
): Promise<
  | { error: string }
  | { id: string; client_id: string; service_id: string; defaultDuration: number }
> {
  const { data, error } = await admin
    .from('treatment_packages')
    .select('id, client_id, service_id, status')
    .eq('id', packageId)
    .eq('clinic_id', clinicId)
    .maybeSingle()
  if (error) return { error: fmtSupabaseError('Failed to load package', error) }
  if (!data) return { error: 'Package not found' }
  if (data.client_id !== expectedClientId) return { error: 'Package does not belong to this client' }
  if (data.status !== 'active') return { error: 'Package is not active' }
  if (!data.service_id) return { error: 'Package has no service attached — set a service on the package first' }
  const { data: svc } = await admin
    .from('services')
    .select('duration_minutes')
    .eq('id', data.service_id)
    .eq('clinic_id', clinicId)
    .maybeSingle()
  return {
    id: data.id,
    client_id: data.client_id,
    service_id: data.service_id,
    defaultDuration: svc?.duration_minutes ?? 60,
  }
}

export async function createAppointment(formData: FormData): Promise<Result> {
  try {
    const auth = await getAuthorizedClinic()
    if ('error' in auth) return { error: auth.error }
    const { clinicId } = auth

    const clientId = ((formData.get('client_id') as string) ?? '').trim()
    const packageId = ((formData.get('package_id') as string) ?? '').trim()
    const startsAtStr = (formData.get('starts_at') as string) ?? ''

    if (!clientId) return { error: 'Please select a client' }
    if (!packageId) return { error: 'Please select a package for this client' }
    if (!startsAtStr) return { error: 'Start date/time is required' }

    const admin = createAdminClient()

    // Verify the client belongs to this clinic, and pull the canonical
    // name/email/phone to denormalize onto the appointment row.
    const { data: client, error: clientErr } = await admin
      .from('clients')
      .select('id, name, email, phone')
      .eq('id', clientId)
      .eq('clinic_id', clinicId)
      .maybeSingle()
    if (clientErr) return { error: fmtSupabaseError('Failed to load client', clientErr) }
    if (!client) return { error: 'Client not found' }

    // Validate the package and pull its service_id (the appointment cannot
    // store its own service — the service comes from the package).
    const pkg = await loadActivePackage(admin, clinicId, packageId, client.id)
    if ('error' in pkg) return { error: pkg.error }

    const duration = parseDuration(formData.get('duration_minutes'), pkg.defaultDuration)
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
    const newStatus = ((formData.get('status') as string) || 'pending') as AptStatus

    // Overlap check: only enforced when a staff member is assigned and the new
    // appointment is not itself cancelled.
    if (staffId && newStatus !== 'cancelled') {
      const conflict = await findStaffConflict(admin, clinicId, staffId, startsAt.toISOString(), endsAt.toISOString(), null)
      if (conflict) return { error: formatConflict(conflict) }
    }

    const { error } = await admin.from('appointments').insert({
      clinic_id: clinicId,
      client_id: client.id,
      client_name: client.name,
      client_email: client.email,
      client_phone: client.phone,
      service_id: pkg.service_id,
      staff_id: staffId,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      status: newStatus,
      notes: (formData.get('notes') as string) || null,
      package_id: pkg.id,
    })

    if (error) {
      console.error('[appointments.create] insert appointments failed', error)
      return { error: fmtSupabaseError('Failed to create appointment', error) }
    }

    if (newStatus === 'completed') {
      await incrementPackageSessions(admin, pkg.id)
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

  const clientId = ((formData.get('client_id') as string) ?? '').trim()
  const packageId = ((formData.get('package_id') as string) ?? '').trim()
  const startsAtStr = (formData.get('starts_at') as string) ?? ''

  if (!clientId) return { error: 'Please select a client' }
  if (!packageId) return { error: 'Please select a package for this client' }
  if (!startsAtStr) return { error: 'Start date/time is required' }

  const admin = createAdminClient()

  const { data: currentApt } = await admin
    .from('appointments')
    .select('status, package_id, client_id, service_id')
    .eq('id', id)
    .eq('clinic_id', clinicId)
    .single()

  if (!currentApt) return { error: 'Appointment not found' }

  const { data: client, error: clientErr } = await admin
    .from('clients')
    .select('id, name, email, phone')
    .eq('id', clientId)
    .eq('clinic_id', clinicId)
    .maybeSingle()
  if (clientErr) return { error: fmtSupabaseError('Failed to load client', clientErr) }
  if (!client) return { error: 'Client not found' }

  const pkg = await loadActivePackage(admin, clinicId, packageId, client.id)
  if ('error' in pkg) return { error: pkg.error }

  const duration = parseDuration(formData.get('duration_minutes'), pkg.defaultDuration)
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
  const newStatus = ((formData.get('status') as string) || 'pending') as AptStatus

  if (staffId && newStatus !== 'cancelled') {
    const conflict = await findStaffConflict(admin, clinicId, staffId, startsAt.toISOString(), endsAt.toISOString(), id)
    if (conflict) return { error: formatConflict(conflict) }
  }

  const { error } = await admin
    .from('appointments')
    .update({
      client_id: client.id,
      client_name: client.name,
      client_email: client.email,
      client_phone: client.phone,
      service_id: pkg.service_id,
      staff_id: staffId,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      status: newStatus,
      notes: (formData.get('notes') as string) || null,
      package_id: pkg.id,
    })
    .eq('id', id)
    .eq('clinic_id', clinicId)

  if (error) return { error: 'Failed to update appointment' }

  // Session counter sync — keeps the package's `completed_sessions` honest
  // without ever double-counting a completed appointment:
  //   • non-completed → completed: credit the new package once
  //   • completed → non-completed: refund the old package (it was credited
  //     before, so keep the counter accurate)
  //   • completed → completed but package_id changed: move the credit
  const wasCompleted = currentApt.status === 'completed'
  const isCompleted = newStatus === 'completed'
  if (!wasCompleted && isCompleted) {
    await incrementPackageSessions(admin, pkg.id)
  } else if (wasCompleted && !isCompleted && currentApt.package_id) {
    await decrementPackageSessions(admin, currentApt.package_id)
  } else if (
    wasCompleted &&
    isCompleted &&
    currentApt.package_id !== pkg.id
  ) {
    if (currentApt.package_id) await decrementPackageSessions(admin, currentApt.package_id)
    await incrementPackageSessions(admin, pkg.id)
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
