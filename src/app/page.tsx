import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Calendar, Users, Sparkles, ArrowRight, Star } from 'lucide-react'

export default function LandingPage() {
  return (
    <div className="bg-surface-gradient flex min-h-screen flex-col">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/70 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <span className="text-lg font-semibold tracking-tight">GlowBook</span>
          </div>
          <nav className="flex items-center gap-2">
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
      <section className="flex flex-1 flex-col items-center justify-center px-6 py-28 text-center">
        <Badge variant="secondary" className="mb-6 gap-1.5 border border-border/70 bg-card/60 backdrop-blur">
          <Star className="h-3 w-3 fill-primary text-primary" />
          Built for beauty professionals
        </Badge>
        <h1 className="max-w-3xl text-5xl font-semibold tracking-tight text-foreground sm:text-6xl lg:text-7xl">
          Manage your beauty center{' '}
          <span className="bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
            effortlessly
          </span>
        </h1>
        <p className="mt-8 max-w-xl text-lg leading-relaxed text-muted-foreground">
          Appointments, clients, staff, and services — all in one clean dashboard.
          Let your clients book online while you focus on what you do best.
        </p>
        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
          <Button size="lg" className="h-11 gap-2 px-6 text-sm" render={<Link href="/signup" />}>
            Start free trial
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="h-11 px-6 text-sm"
            render={<Link href="/login" />}
          >
            Sign in to dashboard
          </Button>
        </div>
        <p className="mt-6 text-xs text-muted-foreground">
          14-day free trial · No credit card required
        </p>
      </section>

      {/* Features */}
      <section className="border-t border-border/60 bg-background/70 px-6 py-24 backdrop-blur-sm">
        <div className="mx-auto max-w-5xl">
          <div className="mb-14 flex flex-col items-center text-center">
            <h2 className="text-3xl font-semibold tracking-tight">
              Everything you need
            </h2>
            <p className="mt-3 max-w-md text-sm text-muted-foreground">
              Premium tools, designed for the way your studio actually works.
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-3">
            {features.map((f) => (
              <div
                key={f.title}
                className="group flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-card transition-shadow duration-200 hover:shadow-card-hover"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <f.Icon className="h-5 w-5" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <h3 className="font-semibold tracking-tight">{f.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{f.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/60 px-6 py-8 text-center text-sm text-muted-foreground">
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
