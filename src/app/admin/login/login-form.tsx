'use client'

import { useActionState } from 'react'
import { signInAdmin } from '@/lib/actions/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function AdminLoginForm() {
  const [state, action, pending] = useActionState(signInAdmin, undefined)

  return (
    <form action={action} className="flex flex-col gap-5">
      {state?.error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {state.error}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="email" className="text-xs font-medium">Admin email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="admin@example.com"
          autoComplete="email"
          required
          className="h-10 px-3 text-sm"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password" className="text-xs font-medium">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          placeholder="••••••••"
          autoComplete="current-password"
          required
          className="h-10 px-3 text-sm"
        />
      </div>

      <Button type="submit" className="mt-1 h-10 w-full text-sm" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in as admin'}
      </Button>
    </form>
  )
}
