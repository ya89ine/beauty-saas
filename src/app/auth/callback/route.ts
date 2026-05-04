import { NextResponse, type NextRequest } from 'next/server'

import { createClient } from '@/lib/supabase/server'

function siteOrigin(request: NextRequest): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '')
  if (env) return env
  return new URL(request.url).origin
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const origin = siteOrigin(request)

  const code = searchParams.get('code')
  const errorDescription = searchParams.get('error_description') ?? searchParams.get('error')
  const next = searchParams.get('next') ?? '/dashboard'
  const safeNext = next.startsWith('/') ? next : '/dashboard'

  if (errorDescription) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(errorDescription)}`
    )
  }

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${safeNext}`)
    }
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`
    )
  }

  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent('This link is invalid or has expired.')}`
  )
}
