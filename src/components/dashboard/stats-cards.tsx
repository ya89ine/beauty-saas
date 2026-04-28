import { Calendar, Users, Clock, AlertCircle, Scissors, UserCheck, TrendingUp } from 'lucide-react'

interface Props {
  totalClients: number
  totalAppointments: number
  totalStaff: number
  totalServices: number
  todayCount: number
  pendingCount: number
  revenueToday: number
  revenueThisWeek: number
  revenueThisMonth: number
  currency: string
}

function formatCurrency(amount: number, currency: string): string {
  if (!currency) return amount.toLocaleString('fr-MA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `${currency} ${amount}`
  }
}

function StatCard({
  label,
  value,
  Icon,
  emphasis = false,
}: {
  label: string
  value: string | number
  Icon: React.ComponentType<{ className?: string }>
  emphasis?: boolean
}) {
  return (
    <div className="group relative flex flex-col gap-3 overflow-hidden rounded-xl border border-border bg-card p-5 shadow-card transition-shadow duration-200 hover:shadow-card-hover">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </p>
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-lg ${
            emphasis ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
          }`}
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="text-3xl font-semibold leading-none tracking-tight tabular-nums text-foreground">
        {value}
      </p>
    </div>
  )
}

function SectionHeading({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3">
      <h2 className="text-sm font-medium text-foreground">{title}</h2>
      <div className="h-px flex-1 bg-border" />
    </div>
  )
}

export function StatsCards({
  totalClients,
  totalAppointments,
  totalStaff,
  totalServices,
  todayCount,
  pendingCount,
  revenueToday,
  revenueThisWeek,
  revenueThisMonth,
  currency,
}: Props) {
  const overviewStats = [
    { label: "Today's appointments", value: todayCount,         Icon: Calendar,    emphasis: true },
    { label: 'Pending confirmations', value: pendingCount,      Icon: AlertCircle, emphasis: true },
    { label: 'Total clients',         value: totalClients,      Icon: Users },
    { label: 'All-time appointments', value: totalAppointments, Icon: Clock },
    { label: 'Staff members',         value: totalStaff,        Icon: UserCheck },
    { label: 'Services offered',      value: totalServices,     Icon: Scissors },
  ]

  const revenueStats = [
    { label: 'Revenue today',      value: formatCurrency(revenueToday,      currency), Icon: TrendingUp },
    { label: 'Revenue this week',  value: formatCurrency(revenueThisWeek,   currency), Icon: TrendingUp },
    { label: 'Revenue this month', value: formatCurrency(revenueThisMonth,  currency), Icon: TrendingUp, emphasis: true },
  ]

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <SectionHeading title="Overview" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {overviewStats.map((s) => (
            <StatCard key={s.label} {...s} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading title="Revenue" />
        <div className="grid gap-4 sm:grid-cols-3">
          {revenueStats.map((s) => (
            <StatCard key={s.label} {...s} />
          ))}
        </div>
      </section>
    </div>
  )
}
