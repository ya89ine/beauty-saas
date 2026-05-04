'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useActionState, useEffect, useState } from 'react'
import { AlertCircle, Loader2 } from 'lucide-react'

import { updatePassword } from '@/lib/actions/auth'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/ui/password-input'

type ExchangeState = 'pending' | 'ready' | 'error'

export function ResetPasswordForm() {
  const searchParams = useSearchParams()
  const [exchangeStatus, setExchangeStatus] = useState<ExchangeState>('pending')
  const [exchangeError, setExchangeError] = useState<string | null>(null)
  const [state, action, pending] = useActionState(updatePassword, undefined)

  useEffect(() => {
    const supabaseError =
      searchParams.get('error_description') ?? searchParams.get('error')
    if (supabaseError) {
      setExchangeError(supabaseError)
      setExchangeStatus('error')
      return
    }

    const code = searchParams.get('code')
    if (!code) {
      // No code in URL — assume user already has a session (e.g. opened from another tab)
      setExchangeStatus('ready')
      return
    }

    const supabase = createClient()
    supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
      if (error) {
        setExchangeError(error.message)
        setExchangeStatus('error')
      } else {
        setExchangeStatus('ready')
      }
    })
  }, [searchParams])

  if (exchangeStatus === 'pending') {
    return (
      <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Verifying your reset link…</span>
      </div>
    )
  }

  if (exchangeStatus === 'error') {
    return (
      <div className="flex flex-col gap-4">
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {exchangeError ??
              'Your reset link is invalid or has expired. Request a new one to continue.'}
          </span>
        </div>
        <Link
          href="/forgot-password"
          className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
        >
          Request a new link
        </Link>
      </div>
    )
  }

  return (
    <form action={action} className="flex flex-col gap-5">
      {state?.error && (
        <div
          role="alert"
          aria-live="polite"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="password" className="text-xs font-medium">New password</Label>
        <PasswordInput
          id="password"
          name="password"
          placeholder="At least 8 characters"
          autoComplete="new-password"
          minLength={8}
          required
          className="h-10 px-3 text-sm"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="confirm_password" className="text-xs font-medium">Confirm password</Label>
        <PasswordInput
          id="confirm_password"
          name="confirm_password"
          placeholder="Re-enter your new password"
          autoComplete="new-password"
          minLength={8}
          required
          className="h-10 px-3 text-sm"
        />
      </div>

      <Button type="submit" className="mt-1 h-10 w-full text-sm" disabled={pending}>
        {pending ? 'Updating password…' : 'Update password'}
      </Button>
    </form>
  )
}
