'use client'

import { useActionState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClinic } from './actions'

type State = { error?: string; success?: boolean } | undefined

export function OnboardingForm() {
  const [state, action, pending] = useActionState<State, FormData>(createClinic, undefined)

  useEffect(() => {
    if (state?.success) {
      // Hard navigation bypasses the Next.js Router Cache, which would otherwise
      // serve the stale /dashboard RSC payload from before the clinic existed.
      window.location.href = '/dashboard'
    }
  }, [state])

  return (
    <form action={action} className="flex flex-col gap-5">
      {state?.error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {state.error}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Clinic name</Label>
        <Input
          id="name"
          name="name"
          placeholder="Glow Beauty Studio"
          required
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="slug">
          Booking URL slug
          <span className="ml-2 text-xs text-muted-foreground">
            glowbook.app/book/<em>your-slug</em>
          </span>
        </Label>
        <Input
          id="slug"
          name="slug"
          placeholder="glow-beauty-studio"
          pattern="[a-z0-9-]+"
          title="Lowercase letters, numbers, and hyphens only"
          required
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Business email (optional)</Label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="contact@yourbeautyclinic.com"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="phone">Business phone (optional)</Label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          placeholder="+1 (555) 000-0000"
        />
      </div>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? 'Creating your clinic…' : 'Create clinic & go to dashboard'}
      </Button>
    </form>
  )
}
