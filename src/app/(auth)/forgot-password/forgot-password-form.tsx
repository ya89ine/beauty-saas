'use client'

import { useActionState } from 'react'
import { AlertCircle, CheckCircle2 } from 'lucide-react'

import { requestPasswordReset } from '@/lib/actions/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, undefined)

  if (state?.success) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary"
      >
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{state.success}</span>
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
        <Label htmlFor="email" className="text-xs font-medium">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="you@example.com"
          autoComplete="email"
          required
          className="h-10 px-3 text-sm"
        />
      </div>

      <Button type="submit" className="mt-1 h-10 w-full text-sm" disabled={pending}>
        {pending ? 'Sending link…' : 'Send reset link'}
      </Button>
    </form>
  )
}
