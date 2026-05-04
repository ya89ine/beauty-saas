import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sparkles, MapPin, Phone, Mail } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { getServiceHex } from '@/lib/service-colors'

export async function generateMetadata(props: PageProps<'/book/[slug]'>): Promise<Metadata> {
  const { slug } = await props.params
  return { title: `Book an appointment` }
}

export default async function PublicBookingPage(props: PageProps<'/book/[slug]'>) {
  const { slug } = await props.params
  const supabase = await createClient()

  const { data: clinic } = await supabase
    .from('clinics')
    .select('id, name, email, phone, address, booking_enabled')
    .eq('slug', slug)
    .single()

  if (!clinic || !clinic.booking_enabled) notFound()

  const { data: services } = await supabase
    .from('services')
    .select('id, name, description, duration_minutes, price, currency, category, color')
    .eq('clinic_id', clinic.id)
    .eq('is_active', true)
    .order('category')
    .order('name')

  const grouped = groupByCategory(services ?? [])

  return (
    <div className="min-h-screen bg-muted/40">
      {/* Header */}
      <header className="border-b bg-background">
        <div className="mx-auto max-w-2xl px-6 py-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary">
              <Sparkles className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">{clinic.name}</h1>
              <p className="text-sm text-muted-foreground">Online booking</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-4 text-sm text-muted-foreground">
            {clinic.address && (
              <span className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                {clinic.address}
              </span>
            )}
            {clinic.phone && (
              <span className="flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5" />
                {clinic.phone}
              </span>
            )}
            {clinic.email && (
              <span className="flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5" />
                {clinic.email}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Services */}
      <main className="mx-auto max-w-2xl px-6 py-10">
        <h2 className="mb-6 text-lg font-semibold">Choose a service</h2>

        {services?.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card py-16 text-center text-sm text-muted-foreground shadow-card">
            No services available at the moment.
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            {Object.entries(grouped).map(([category, items]) => (
              <div key={category}>
                {category !== '_' && (
                  <h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-muted-foreground">
                    {category}
                  </h3>
                )}
                <div className="flex flex-col gap-3">
                  {items.map((service) => (
                    <Card
                      key={service.id}
                      className="cursor-pointer border shadow-sm transition-shadow hover:shadow-md"
                    >
                      <CardContent className="flex items-center justify-between gap-4 p-5">
                        <div className="flex items-center gap-4">
                          <div
                            className="h-10 w-1 shrink-0 rounded-full"
                            style={{ backgroundColor: getServiceHex(service) }}
                          />
                          <div>
                            <p className="font-medium">{service.name}</p>
                            {service.description && (
                              <p className="mt-0.5 text-sm text-muted-foreground line-clamp-1">
                                {service.description}
                              </p>
                            )}
                            <p className="mt-1 text-xs text-muted-foreground">
                              {service.duration_minutes} min
                            </p>
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <Badge variant="secondary" className="text-sm font-semibold">
                            {service.currency} {Number(service.price).toFixed(2)}
                          </Badge>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <footer className="pb-8 text-center text-xs text-muted-foreground">
        Powered by{' '}
        <span className="font-medium text-foreground">GlowBook</span>
      </footer>
    </div>
  )
}

type ServiceRow = {
  id: string
  name: string
  description: string | null
  duration_minutes: number
  price: number
  currency: string
  category: string | null
  color: string | null
}

function groupByCategory(services: ServiceRow[]): Record<string, ServiceRow[]> {
  return services.reduce<Record<string, ServiceRow[]>>((acc, s) => {
    const key = s.category ?? '_'
    ;(acc[key] ??= []).push(s)
    return acc
  }, {})
}
