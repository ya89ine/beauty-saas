import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// Service-role client — bypasses RLS. Only use server-side for trusted lookups
// where the calling code already verified the user via getUser().
export function createAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        fetch: (url, options = {}) => fetch(url, { ...options, cache: 'no-store' }),
      },
    }
  )
}
