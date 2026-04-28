import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Note: /admin gating lives in src/proxy.ts (single source of truth).
// This layout deliberately does NOT check isAdminEmail — that check belongs
// to the proxy alone. We only ensure a session exists (defensive net) and
// redirect to /login if not. We never redirect to /dashboard from here, so
// an admin can never be bounced out of /admin by this layout.
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  return <>{children}</>
}
