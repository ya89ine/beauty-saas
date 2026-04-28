'use client'

import { useActionState } from 'react'
import { signUp } from '@/lib/actions/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function SignupForm() {
  const [state, action, pending] = useActionState(signUp, undefined)

  if (state?.success) {
    return (
      <div className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
        {state.success}
      </div>
    )
  }

  return (
    <form action={action} className="flex flex-col gap-5">
      {state?.error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {state.error}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="full_name" className="text-xs font-medium">Full name</Label>
        <Input
          id="full_name"
          name="full_name"
          type="text"
          placeholder="Jane Smith"
          autoComplete="name"
          required
          className="h-10 px-3 text-sm"
        />
      </div>

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
        <Label htmlFor="password" className="text-xs font-medium">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          placeholder="At least 8 characters"
          autoComplete="new-password"
          minLength={8}
          required
          className="h-10 px-3 text-sm"
        />
      </div>

      <Button type="submit" className="mt-1 h-10 w-full text-sm" disabled={pending}>
        {pending ? 'Creating account…' : 'Create account'}
      </Button>
    </form>
  )
}
