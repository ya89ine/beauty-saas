'use client'

import { useState, useMemo } from 'react'
import { parseISO, startOfDay, endOfDay, format } from 'date-fns'
import { Crown, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

type StaffMember = { id: string; name: string; role: string }

// FIX 1: removed `price` (doesn't exist in DB), added client_email + client_name
type Appointment = {
  id: string
  starts_at: string
  status: string
  staff_id: string | null
  client_id: string | null
  client_email: string | null
  client_name: string | null
  service: { price: number } | null
}

type StatRow = {
  id: string
  name: string
  role: string
  isUnassigned: boolean
  appointmentCount: number
  revenue: number
  clientsServed: number
}

interface Props {
  staffList: StaffMember[]
  appointments: Appointment[]
}

type Period = 'today' | 'week' | 'month' | 'custom'
type SortKey = 'appointments' | 'revenue' | 'clients'
type SortDir = 'asc' | 'desc'

const PERIOD_LABELS: Record<Period, string> = {
  today: 'Today',
  week: 'This Week',
  month: 'This Month',
  custom: 'Custom',
}

const UNASSIGNED_ID = '__unassigned__'

// FIX 2: price column doesn't exist — revenue comes from service.price only
function effectivePrice(apt: Appointment): number {
  return apt.service?.price ?? 0
}

// FIX 3: client_id is null on all rows — use email or name for deduplication
function clientKey(apt: Appointment): string | null {
  return apt.client_email ?? apt.client_name ?? null
}

function formatDH(amount: number): string {
  return `${amount.toLocaleString('fr-MA', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} DH`
}

function SortIcon({
  col,
  sortKey,
  sortDir,
}: {
  col: SortKey
  sortKey: SortKey
  sortDir: SortDir
}) {
  if (sortKey !== col)
    return <ChevronsUpDown className="ml-1 inline h-3 w-3 opacity-40" />
  return sortDir === 'desc' ? (
    <ChevronDown className="ml-1 inline h-3 w-3" />
  ) : (
    <ChevronUp className="ml-1 inline h-3 w-3" />
  )
}

export function StaffPerformanceClient({ staffList, appointments }: Props) {
  const now = new Date()

  const [period, setPeriod] = useState<Period>('month')
  const [customFrom, setCustomFrom] = useState(
    format(new Date(now.getFullYear(), now.getMonth(), 1), 'yyyy-MM-dd'),
  )
  const [customTo, setCustomTo] = useState(
    format(new Date(now.getFullYear(), now.getMonth() + 1, 0), 'yyyy-MM-dd'),
  )
  const [filterStaffId, setFilterStaffId] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('revenue')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const { rangeStart, rangeEnd } = useMemo(() => {
    const n = new Date()
    const startToday = startOfDay(n)
    const endToday = endOfDay(n)

    if (period === 'today') return { rangeStart: startToday, rangeEnd: endToday }

    if (period === 'week') {
      const startWeek = new Date(startToday)
      startWeek.setDate(
        startToday.getDate() - (startToday.getDay() === 0 ? 6 : startToday.getDay() - 1),
      )
      return { rangeStart: startWeek, rangeEnd: endToday }
    }

    if (period === 'month') {
      return {
        rangeStart: new Date(n.getFullYear(), n.getMonth(), 1),
        rangeEnd: new Date(n.getFullYear(), n.getMonth() + 1, 0, 23, 59, 59, 999),
      }
    }

    return {
      rangeStart: customFrom ? startOfDay(new Date(customFrom)) : startToday,
      rangeEnd: customTo ? endOfDay(new Date(customTo)) : endToday,
    }
  }, [period, customFrom, customTo])

  function inPeriod(apt: Appointment): boolean {
    const d = parseISO(apt.starts_at)
    return d >= rangeStart && d <= rangeEnd
  }

  function buildRow(
    id: string,
    name: string,
    role: string,
    isUnassigned: boolean,
    apts: Appointment[],
  ): StatRow {
    return {
      id,
      name,
      role,
      isUnassigned,
      appointmentCount: apts.length,
      revenue: apts.reduce((s, a) => s + effectivePrice(a), 0),
      clientsServed: new Set(apts.map(clientKey).filter(Boolean)).size,
    }
  }

  // Compute rows — staff rows + optional unassigned row
  const stats: StatRow[] = useMemo(() => {
    const rows: StatRow[] = []

    const showingUnassignedOnly = filterStaffId === UNASSIGNED_ID
    const showingSpecificStaff = filterStaffId !== '' && filterStaffId !== UNASSIGNED_ID

    // Named staff rows
    if (!showingUnassignedOnly) {
      const staffToShow = showingSpecificStaff
        ? staffList.filter((s) => s.id === filterStaffId)
        : staffList

      for (const member of staffToShow) {
        const apts = appointments.filter(
          (a) => a.staff_id === member.id && inPeriod(a),
        )
        rows.push(buildRow(member.id, member.name, member.role, false, apts))
      }
    }

    // FIX 4: Unassigned row — show when "All staff" or "Unassigned" filter selected
    const showUnassigned = !showingSpecificStaff
    if (showUnassigned) {
      const unassignedApts = appointments.filter(
        (a) => a.staff_id === null && inPeriod(a),
      )
      if (unassignedApts.length > 0) {
        rows.push(buildRow(UNASSIGNED_ID, 'Unassigned', '', true, unassignedApts))
      }
    }

    return rows
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffList, appointments, filterStaffId, rangeStart, rangeEnd])

  const sorted = useMemo(() => {
    return [...stats].sort((a, b) => {
      const av =
        sortKey === 'appointments'
          ? a.appointmentCount
          : sortKey === 'revenue'
            ? a.revenue
            : a.clientsServed
      const bv =
        sortKey === 'appointments'
          ? b.appointmentCount
          : sortKey === 'revenue'
            ? b.revenue
            : b.clientsServed
      return sortDir === 'desc' ? bv - av : av - bv
    })
  }, [stats, sortKey, sortDir])

  // Top performer: highest revenue, named staff only (not unassigned)
  const topId = sorted.find((s) => !s.isUnassigned && s.revenue > 0)?.id ?? null

  // Total unique clients across the whole period (for footer)
  const totalUniqueClients = useMemo(() => {
    return new Set(
      appointments
        .filter((a) => inPeriod(a))
        .map(clientKey)
        .filter(Boolean),
    ).size
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointments, rangeStart, rangeEnd])

  const hasUnassignedInData = appointments.some((a) => a.staff_id === null)

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Staff Performance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Completed appointments, revenue, and clients per staff member
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Period</span>
          <div className="flex overflow-hidden rounded-md border">
            {(Object.keys(PERIOD_LABELS) as Period[]).map((p, i, arr) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={[
                  'px-3 py-1.5 text-sm transition-colors',
                  i < arr.length - 1 ? 'border-r' : '',
                  period === p
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted',
                ].join(' ')}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
        </div>

        {period === 'custom' && (
          <>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">From</span>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-9 rounded-md border px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">To</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-9 rounded-md border px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </>
        )}

        {(staffList.length > 1 || hasUnassignedInData) && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Staff</span>
            <select
              value={filterStaffId}
              onChange={(e) => setFilterStaffId(e.target.value)}
              className="h-9 rounded-md border px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">All staff</option>
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
              {hasUnassignedInData && (
                <option value={UNASSIGNED_ID}>Unassigned</option>
              )}
            </select>
          </div>
        )}
      </div>

      {staffList.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No active staff members found.
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 hover:bg-muted/40">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Staff</th>
                <th
                  className="cursor-pointer select-none px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => toggleSort('appointments')}
                >
                  Appointments
                  <SortIcon col="appointments" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th
                  className="cursor-pointer select-none px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => toggleSort('revenue')}
                >
                  Revenue
                  <SortIcon col="revenue" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th
                  className="cursor-pointer select-none px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => toggleSort('clients')}
                >
                  Clients Served
                  <SortIcon col="clients" sortKey={sortKey} sortDir={sortDir} />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {sorted.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="py-12 text-center text-sm text-muted-foreground"
                  >
                    No completed appointments found for this period.
                  </td>
                </tr>
              )}
              {sorted.map((s) => {
                const isTop = s.id === topId
                return (
                  <tr
                    key={s.id}
                    className={
                      isTop
                        ? 'bg-amber-50 dark:bg-amber-950/20'
                        : s.isUnassigned
                          ? 'bg-muted/20'
                          : 'hover:bg-muted/30'
                    }
                  >
                    <td
                      className={`px-4 py-4 ${
                        isTop
                          ? 'border-l-4 border-amber-400'
                          : 'border-l-4 border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {isTop && (
                          <Crown className="h-4 w-4 shrink-0 text-amber-500" />
                        )}
                        <div>
                          <span
                            className={`block font-medium ${
                              s.isUnassigned ? 'text-muted-foreground italic' : ''
                            }`}
                          >
                            {s.name}
                          </span>
                          {s.role && (
                            <span className="block text-xs capitalize text-muted-foreground">
                              {s.role}
                            </span>
                          )}
                          {s.isUnassigned && (
                            <span className="block text-xs text-muted-foreground">
                              no staff assigned
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-4 text-center">
                      <span className="block text-xl font-bold tabular-nums">
                        {s.appointmentCount}
                      </span>
                      <span className="text-xs text-muted-foreground">sessions</span>
                    </td>

                    <td className="px-4 py-4 text-center">
                      <span
                        className={`block text-xl font-bold tabular-nums ${
                          isTop ? 'text-amber-600 dark:text-amber-400' : ''
                        }`}
                      >
                        {formatDH(s.revenue)}
                      </span>
                      <span className="text-xs text-muted-foreground">generated</span>
                    </td>

                    <td className="px-4 py-4 text-center">
                      <span className="block text-xl font-bold tabular-nums">
                        {s.clientsServed}
                      </span>
                      <span className="text-xs text-muted-foreground">unique clients</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>

            {sorted.length > 1 && (
              <tfoot>
                <tr className="border-t-2 bg-muted/50 text-xs text-muted-foreground">
                  <td className="px-4 py-3 font-medium">
                    Total
                  </td>
                  <td className="px-4 py-3 text-center font-semibold tabular-nums text-foreground">
                    {sorted.reduce((s, r) => s + r.appointmentCount, 0)}
                  </td>
                  <td className="px-4 py-3 text-center font-semibold tabular-nums text-foreground">
                    {formatDH(sorted.reduce((s, r) => s + r.revenue, 0))}
                  </td>
                  <td className="px-4 py-3 text-center font-semibold tabular-nums text-foreground">
                    {totalUniqueClients}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  )
}
