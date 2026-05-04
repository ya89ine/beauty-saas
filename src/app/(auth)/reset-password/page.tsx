import type { Metadata } from 'next'
import { Suspense } from 'react'
import { Loader2 } from 'lucide-react'

import { ResetPasswordForm } from './reset-password-form'

export const metadata: Metadata = { title: 'Reset password' }

export default function ResetPasswordPage() {
  return (
    <div className="rounded-2xl border border-border bg-card/95 p-8 shadow-card backdrop-blur-sm">
      <div className="mb-7">
        <h1 className="text-2xl font-semibold tracking-tight">Set a new password</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Choose a strong password you haven&apos;t used before.
        </p>
      </div>
      {/* Form reads `?code=` via useSearchParams; Suspense boundary lets the
          shell prerender while the form bails to client-side rendering. */}
      <Suspense
        fallback={
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading…</span>
          </div>
        }
      >
        <ResetPasswordForm />
      </Suspense>
    </div>
  )
}
