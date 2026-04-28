import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/proxy'
import { adminGateInputs } from '@/lib/admin'

// ─────────────────────────────────────────────────────────────────────────────
// Hard, isolated rule for /admin (single source of truth):
//
//   1. If pathname starts with /admin → handle here and EARLY RETURN.
//      Nothing below this block runs for /admin requests.
//
//   2. Order:
//        - not logged in        → /login
//        - logged in AND admin  → continue (allow)
//        - logged in, not admin → /dashboard
//
//   3. Diagnostic logs print on every /admin request so the gate's decision
//      and its inputs (pathname, email, configured admin) are visible.
//
//   4. /admin is intentionally excluded from any non-/admin logic. The
//      (dashboard) route group, /onboarding, and clinic checks live in
//      their own layouts/pages and cannot run for /admin paths because
//      they are separate route segments.
// ─────────────────────────────────────────────────────────────────────────────
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (pathname.startsWith('/admin')) {
    const { response, user } = await updateSession(request)
    const gate = adminGateInputs(user?.email)

    let decision: 'allow' | 'redirect:/login' | 'redirect:/dashboard'
    if (!user) decision = 'redirect:/login'
    else if (gate.match) decision = 'allow'
    else decision = 'redirect:/dashboard'

    // Structured diagnostic — visible in `next dev` output and prod server logs
    console.log('[proxy] /admin gate', {
      pathname,
      userId: user?.id ?? null,
      email: user?.email ?? null,
      configuredAdmin: gate.configured || null,
      gateReason: gate.reason,
      decision,
    })

    if (decision === 'redirect:/login') {
      return NextResponse.redirect(new URL('/login', request.url))
    }
    if (decision === 'allow') {
      return response // EARLY RETURN — no further logic runs for /admin
    }
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  // Non-/admin paths: only refresh the auth session, no gating.
  const { response } = await updateSession(request)
  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
