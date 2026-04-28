import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Calendar, Users, Sparkles, ArrowRight, Star } from 'lucide-react'

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <span className="text-lg font-semibold tracking-tight">GlowBook</span>
          </div>
          <nav className="flex items-center gap-3">
            <Button variant="ghost" size="sm" render={<Link href="/login" />}>
              Sign in
            </Button>
            <Button size="sm" render={<Link href="/signup" />}>
              Get started
            </Button>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
        <Badge variant="secondary" className="mb-6 gap-1.5">
          <Star className="h-3 w-3 fill-primary text-primary" />
          Built for beauty professionals
        </Badge>
        <h1 className="max-w-2xl text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
          Manage your beauty center{' '}
          <span className="text-primary">effortlessly</span>
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted-foreground">
          Appointments, clients, staff, and services — all in one clean dashboard.
          Let your clients book online while you focus on what you do best.
        </p>
        <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
          <Button size="lg" className="gap-2" render={<Link href="/signup" />}>
            Start free trial
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button size="lg" variant="outline" render={<Link href="/login" />}>
            Sign in to dashboard
          </Button>
        </div>
      </section>

      {/* Features */}
      <section className="border-t bg-muted/40 px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-12 text-center text-2xl font-semibold tracking-tight">
            Everything you need
          </h2>
          <div className="grid gap-8 sm:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="flex flex-col gap-3 rounded-xl border bg-card p-6 shadow-sm">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <f.Icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-semibold">{f.title}</h3>
                <p className="text-sm text-muted-foreground">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t px-6 py-8 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} GlowBook. All rights reserved.
      </footer>
    </div>
  )
}

const features = [
  {
    Icon: Calendar,
    title: 'Smart Scheduling',
    description:
      'Visual calendar, drag-and-drop bookings, and automated reminders keep your schedule tight.',
  },
  {
    Icon: Users,
    title: 'Client Management',
    description:
      'Full client profiles, history, and notes so every visit feels personal.',
  },
  {
    Icon: Sparkles,
    title: 'Public Booking',
    description:
      'A branded booking page your clients can use 24/7 — no phone calls required.',
  },
]
