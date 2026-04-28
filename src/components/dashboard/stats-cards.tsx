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
  iconClass,
  iconBg,
  accent,
}: {
  label: string
  value: string | number
  Icon: React.ComponentType<{ className?: string }>
  iconClass: string
  iconBg: string
  accent: string
}) {
  return (
    <div className={`flex items-center gap-4 rounded-xl border border-l-4 ${accent} bg-card p-5 shadow-sm`}>
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${iconBg}`}>
        <Icon className={`h-5 w-5 ${iconClass}`} />
      </div>
      <div className="min-w-0">
        <p className="text-3xl font-bold leading-none tracking-tight tabular-nums">{value}</p>
        <p className="mt-1.5 text-xs text-muted-foreground">{label}</p>
      </div>
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
  const countStats = [
    { label: "Today's appointments", value: todayCount,         Icon: Calendar,    iconClass: 'text-violet-600', iconBg: 'bg-violet-50',  accent: 'border-l-violet-500' },
    { label: 'Pending confirmations', value: pendingCount,      Icon: AlertCircle, iconClass: 'text-amber-600',  iconBg: 'bg-amber-50',   accent: 'border-l-amber-400'  },
    { label: 'Total clients',         value: totalClients,      Icon: Users,       iconClass: 'text-blue-600',   iconBg: 'bg-blue-50',    accent: 'border-l-blue-500'   },
    { label: 'All-time appointments', value: totalAppointments, Icon: Clock,       iconClass: 'text-emerald-600',iconBg: 'bg-emerald-50', accent: 'border-l-emerald-500'},
    { label: 'Staff members',         value: totalStaff,        Icon: UserCheck,   iconClass: 'text-pink-600',   iconBg: 'bg-pink-50',    accent: 'border-l-pink-500'   },
    { label: 'Services offered',      value: totalServices,     Icon: Scissors,    iconClass: 'text-rose-600',   iconBg: 'bg-rose-50',    accent: 'border-l-rose-500'   },
  ]

  const revenueStats = [
    { label: 'Revenue today',      value: formatCurrency(revenueToday,      currency), Icon: TrendingUp, iconClass: 'text-teal-600',   iconBg: 'bg-teal-50',   accent: 'border-l-teal-500'   },
    { label: 'Revenue this week',  value: formatCurrency(revenueThisWeek,   currency), Icon: TrendingUp, iconClass: 'text-cyan-600',   iconBg: 'bg-cyan-50',   accent: 'border-l-cyan-500'   },
    { label: 'Revenue this month', value: formatCurrency(revenueThisMonth,  currency), Icon: TrendingUp, iconClass: 'text-indigo-600', iconBg: 'bg-indigo-50', accent: 'border-l-indigo-500' },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {countStats.map(({ label, value, Icon, iconClass, iconBg, accent }) => (
          <StatCard key={label} label={label} value={value} Icon={Icon} iconClass={iconClass} iconBg={iconBg} accent={accent} />
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {revenueStats.map(({ label, value, Icon, iconClass, iconBg, accent }) => (
          <StatCard key={label} label={label} value={value} Icon={Icon} iconClass={iconClass} iconBg={iconBg} accent={accent} />
        ))}
      </div>
    </div>
  )
}
