import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
  // 1. Verify shared secret
  const secret = req.headers.get('x-ghl-secret')
  if (!process.env.GHL_WEBHOOK_SECRET || secret !== process.env.GHL_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Parse body
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { clinic_slug, name, email, phone, service, datetime, date, time } = body as {
    clinic_slug?: string
    name?: string
    email?: string
    phone?: string
    service?: string
    datetime?: string
    date?: string
    time?: string
  }

  // 3. Validate required fields
  if (!clinic_slug || !name || !service) {
    return NextResponse.json(
      { error: 'Missing required fields: clinic_slug, name, service' },
      { status: 400 }
    )
  }

  if (!email && !phone) {
    return NextResponse.json(
      { error: 'At least one of email or phone is required' },
      { status: 400 }
    )
  }

  // 4. Build starts_at
  let startsAtRaw: string
  if (datetime) {
    startsAtRaw = datetime
  } else if (date && time) {
    // Normalize time to HH:MM:SS so new Date() parses reliably
    const normalizedTime = time.length === 5 ? `${time}:00` : time
    startsAtRaw = `${date}T${normalizedTime}`
  } else {
    return NextResponse.json(
      { error: 'Provide either datetime or both date and time' },
      { status: 400 }
    )
  }

  const startsAt = new Date(startsAtRaw)
  if (isNaN(startsAt.getTime())) {
    return NextResponse.json({ error: `Invalid date/time value: "${startsAtRaw}"` }, { status: 400 })
  }

  const admin = createAdminClient()

  // 5. Find clinic by slug
  const { data: clinic, error: clinicError } = await admin
    .from('clinics')
    .select('id')
    .eq('slug', clinic_slug)
    .maybeSingle()

  if (clinicError) {
    return NextResponse.json({ error: clinicError.message }, { status: 500 })
  }
  if (!clinic) {
    return NextResponse.json({ error: `Clinic not found: "${clinic_slug}"` }, { status: 404 })
  }

  // 6. Find service by name (case-insensitive) within this clinic
  const { data: svc, error: svcError } = await admin
    .from('services')
    .select('id, duration_minutes')
    .eq('clinic_id', clinic.id)
    .ilike('name', service)
    .eq('is_active', true)
    .maybeSingle()

  if (svcError) {
    return NextResponse.json({ error: svcError.message }, { status: 500 })
  }
  if (!svc) {
    return NextResponse.json(
      { error: `No active service found matching: "${service}"` },
      { status: 422 }
    )
  }

  // 7. Find or create client — lookup by email first, then phone
  let clientId: string | null = null

  if (email) {
    const { data, error } = await admin
      .from('clients')
      .select('id')
      .eq('clinic_id', clinic.id)
      .eq('email', email)
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    clientId = data?.id ?? null
  }

  if (!clientId && phone) {
    const { data, error } = await admin
      .from('clients')
      .select('id')
      .eq('clinic_id', clinic.id)
      .eq('phone', phone)
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    clientId = data?.id ?? null
  }

  if (!clientId) {
    const { data: newClient, error: insertError } = await admin
      .from('clients')
      .insert({ clinic_id: clinic.id, name, email: email ?? null, phone: phone ?? null })
      .select('id')
      .single()
    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })
    clientId = newClient.id
  }

  // 8. Create appointment
  const endsAt = new Date(startsAt.getTime() + svc.duration_minutes * 60 * 1000)

  const { data: appointment, error: apptError } = await admin
    .from('appointments')
    .insert({
      clinic_id: clinic.id,
      client_id: clientId,
      service_id: svc.id,
      staff_id: null,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      status: 'confirmed',
      client_name: name,
      client_email: email ?? null,
      client_phone: phone ?? null,
    })
    .select('id')
    .single()

  if (apptError) {
    return NextResponse.json({ error: apptError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, appointment_id: appointment.id }, { status: 201 })
}
