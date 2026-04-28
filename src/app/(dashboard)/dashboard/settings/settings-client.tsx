'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import type { Clinic } from '@/types/database'
import { updateClinic } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const TIMEZONES = [
  'UTC',
  'Africa/Casablanca',
  'Africa/Cairo',
  'Africa/Nairobi',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Asia/Dubai',
  'Asia/Riyadh',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Australia/Sydney',
]

interface Props {
  clinic: Clinic
}

export function SettingsClient({ clinic }: Props) {
  const router = useRouter()
  const [formError, setFormError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setFormError(null)
    const formData = new FormData(e.currentTarget)

    startTransition(async () => {
      const result = await updateClinic(clinic.id, formData)
      if (result.error) {
        setFormError(result.error)
        return
      }
      toast.success('Settings saved')
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Clinic profile, contact info, and booking preferences
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        {formError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {formError}
          </div>
        )}

        {/* Clinic Info */}
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-base font-medium">Clinic info</h2>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Clinic name *</Label>
              <Input
                id="name"
                name="name"
                required
                defaultValue={clinic.name}
                placeholder="My Beauty Studio"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  defaultValue={clinic.email ?? ''}
                  placeholder="contact@studio.com"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  name="phone"
                  type="tel"
                  defaultValue={clinic.phone ?? ''}
                  placeholder="+212 6 00 00 00 00"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="address">Address</Label>
              <Input
                id="address"
                name="address"
                defaultValue={clinic.address ?? ''}
                placeholder="123 Main St, City"
              />
            </div>
          </div>
        </div>

        {/* Preferences */}
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-base font-medium">Preferences</h2>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="timezone">Timezone</Label>
              <select
                id="timezone"
                name="timezone"
                defaultValue={clinic.timezone}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm transition-colors outline-none focus-visible:border-ring cursor-pointer"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="booking_enabled"
                name="booking_enabled"
                defaultChecked={clinic.booking_enabled}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              <Label htmlFor="booking_enabled">Enable online booking page</Label>
            </div>
          </div>
        </div>

        {/* Booking URL */}
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h2 className="mb-1 text-base font-medium">Booking link</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Share this link with your clients so they can browse your services.
          </p>
          <code className="block rounded-lg bg-muted px-3 py-2 text-sm break-all">
            {typeof window !== 'undefined' ? window.location.origin : ''}/book/{clinic.slug}
          </code>
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </div>
  )
}
