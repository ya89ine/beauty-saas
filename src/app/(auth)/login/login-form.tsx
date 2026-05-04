'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { AlertCircle } from 'lucide-react'

import { signIn } from '@/lib/actions/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/ui/password-input'

export function LoginForm() {
  const [state, action, pending] = useActionState(signIn, undefined)

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

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password" className="text-xs font-medium">Password</Label>
          <Link
            href="/forgot-password"
            className="text-xs font-medium text-primary hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <PasswordInput
          id="password"
          name="password"
          placeholder="••••••••"
          autoComplete="current-password"
          required
          className="h-10 px-3 text-sm"
        />
      </div>

      <Button type="submit" className="mt-1 h-10 w-full text-sm" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  )
}
