import { format } from 'date-fns'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Calendar } from 'lucide-react'

type Appointment = {
  id: string
  starts_at: string
  ends_at: string
  status: string
  client_name: string
  service_id: string
}

const STATUS_CONFIG: Record<string, { label: string; dot: string; text: string }> = {
  pending:   { label: 'Pending',   dot: 'bg-amber-400',   text: 'text-amber-700'   },
  confirmed: { label: 'Confirmed', dot: 'bg-emerald-500', text: 'text-emerald-700' },
  cancelled: { label: 'Cancelled', dot: 'bg-slate-400',   text: 'text-slate-500'   },
  completed: { label: 'Completed', dot: 'bg-blue-400',    text: 'text-blue-700'    },
  no_show:   { label: 'No-show',   dot: 'bg-red-400',     text: 'text-red-700'     },
}

function getInitials(name: string): string {
  return name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
}

export function UpcomingAppointments({ appointments }: { appointments: Appointment[] }) {
  return (
    <Card className="border shadow-sm">
      <CardHeader className="flex flex-row items-center gap-2 pb-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
          <Calendar className="h-3.5 w-3.5 text-primary" />
        </div>
        <CardTitle className="text-base font-semibold">Today&apos;s Schedule</CardTitle>
        {appointments.length > 0 && (
          <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/10 px-1.5 text-xs font-semibold text-primary">
            {appointments.length}
          </span>
        )}
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {appointments.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Calendar className="h-5 w-5 text-muted-foreground/50" />
            </div>
            <p className="text-sm font-medium text-muted-foreground">No appointments today</p>
            <p className="text-xs text-muted-foreground/70">Enjoy the quiet day</p>
          </div>
        ) : (
          <div className="divide-y">
            {appointments.map((apt, i) => {
              const status = STATUS_CONFIG[apt.status] ?? STATUS_CONFIG.pending
              return (
                <div
                  key={apt.id}
                  className={`flex items-center gap-4 px-6 py-3.5 transition-colors hover:bg-muted/30 ${i === 0 ? 'border-t' : ''}`}
                >
                  {/* Time */}
                  <div className="w-14 shrink-0 text-center">
                    <span className="block text-sm font-semibold tabular-nums">
                      {format(new Date(apt.starts_at), 'HH:mm')}
                    </span>
                    <span className="block text-[11px] tabular-nums text-muted-foreground">
                      {format(new Date(apt.ends_at), 'HH:mm')}
                    </span>
                  </div>

                  <div className="h-8 w-px shrink-0 bg-border" />

                  {/* Avatar + name */}
                  <div className="flex flex-1 items-center gap-2.5 min-w-0">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                      {getInitials(apt.client_name)}
                    </div>
                    <p className="truncate text-sm font-medium">{apt.client_name}</p>
                  </div>

                  {/* Status pill */}
                  <div className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${status.text}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
                    {status.label}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
