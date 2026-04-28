'use client'

import { useState, useMemo, useTransition, useRef } from 'react'
import { format, parseISO, startOfDay, endOfDay } from 'date-fns'
import { Pencil, Check, TrendingUp } from 'lucide-react'
import { updateAppointmentPrice, toggleAppointmentPaid } from './actions'

type ServiceInfo = { name: string; price: number; currency: string }
type StaffInfo = { name: string }

export type RevenueAppointment = {
  id: string
  starts_at: string
  ends_at: string
  status: string
  client_name: string
  staff_id: string | null
  price: number | null
  is_paid: boolean
  service: ServiceInfo | null
  staff: StaffInfo | null
}

type StaffMember = { id: string; name: string }

interface Props {
  appointments: RevenueAppointment[]
  staffList: StaffMember[]
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No Show',
}

function effectivePrice(apt: RevenueAppointment): number {
  if (apt.price !== null && apt.price !== undefined) return apt.price
  return apt.service?.price ?? 0
}

function formatDH(amount: number): string {
  return `${amount.toLocaleString('fr-MA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} DH`
}

const SUMMARY_ACCENTS = ['border-l-violet-500 bg-violet-50 text-violet-600', 'border-l-blue-500 bg-blue-50 text-blue-600', 'border-l-emerald-500 bg-emerald-50 text-emerald-600']

function SummaryCard({
  label,
  total,
  paid,
  accentIndex = 0,
}: {
  label: string
  total: number
  paid: number
  accentIndex?: number
}) {
  const unpaid = total - paid
  const [borderAccent, iconBg, iconColor] = (SUMMARY_ACCENTS[accentIndex] ?? SUMMARY_ACCENTS[0]).split(' ')
  return (
    <div className={`flex items-center gap-4 rounded-xl border border-l-4 ${borderAccent} bg-card p-5 shadow-sm`}>
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${iconBg}`}>
        <TrendingUp className={`h-5 w-5 ${iconColor}`} />
      </div>
      <div className="min-w-0">
        <p className="text-3xl font-bold leading-none tracking-tight tabular-nums">{formatDH(total)}</p>
        <p className="mt-1.5 text-xs text-muted-foreground">{label}</p>
        <div className="mt-1 flex gap-3 text-xs">
          <span className="text-emerald-600">{formatDH(paid)} paid</span>
          {unpaid > 0 && (
            <span className="text-amber-600">{formatDH(unpaid)} unpaid</span>
          )}
        </div>
      </div>
    </div>
  )
}

function PriceCell({
  apt,
  onSave,
}: {
  apt: RevenueAppointment
  onSave: (id: string, price: number | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function startEdit() {
    setValue(String(effectivePrice(apt)))
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  function save() {
    setEditing(false)
    const num = parseFloat(value)
    onSave(apt.id, isNaN(num) ? null : num)
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') save()
    if (e.key === 'Escape') setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          type="number"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={handleKey}
          className="w-20 rounded border px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <span className="text-xs text-muted-foreground">DH</span>
      </div>
    )
  }

  return (
    <button
      onClick={startEdit}
      className="group flex items-center gap-1 rounded px-1.5 py-0.5 text-sm hover:bg-muted"
    >
      {formatDH(effectivePrice(apt))}
      {apt.price !== null && (
        <span className="text-[10px] text-muted-foreground">(custom)</span>
      )}
      <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
    </button>
  )
}

export function RevenueClient({ appointments, staffList }: Props) {
  const [, startTransition] = useTransition()
  const [optimisticPrices, setOptimisticPrices] = useState<
    Record<string, number | null>
  >({})
  const [optimisticPaid, setOptimisticPaid] = useState<Record<string, boolean>>(
    {},
  )

  const now = new Date()
  const defaultFrom = format(
    new Date(now.getFullYear(), now.getMonth(), 1),
    'yyyy-MM-dd',
  )
  const defaultTo = format(
    new Date(now.getFullYear(), now.getMonth() + 1, 0),
    'yyyy-MM-dd',
  )
  const [filterFrom, setFilterFrom] = useState(defaultFrom)
  const [filterTo, setFilterTo] = useState(defaultTo)
  const [filterStaff, setFilterStaff] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'paid' | 'unpaid'>(
    'all',
  )

  const displayApts = useMemo(
    () =>
      appointments.map((apt) => ({
        ...apt,
        price:
          apt.id in optimisticPrices ? optimisticPrices[apt.id] : apt.price,
        is_paid:
          apt.id in optimisticPaid ? optimisticPaid[apt.id] : apt.is_paid,
      })),
    [appointments, optimisticPrices, optimisticPaid],
  )

  // Summary period calculations
  const startToday = startOfDay(now)
  const endToday = endOfDay(now)
  const startWeek = new Date(startToday)
  startWeek.setDate(
    startToday.getDate() - (startToday.getDay() === 0 ? 6 : startToday.getDay() - 1),
  )
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const endMonth = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
    23,
    59,
    59,
    999,
  )

  function sumForPeriod(from: Date, to: Date, paidOnly = false): number {
    return displayApts
      .filter((a) => {
        const d = parseISO(a.starts_at)
        return d >= from && d <= to && (!paidOnly || a.is_paid)
      })
      .reduce((s, a) => s + effectivePrice(a), 0)
  }

  const filtered = useMemo(() => {
    const from = filterFrom ? startOfDay(new Date(filterFrom)) : null
    const to = filterTo ? endOfDay(new Date(filterTo)) : null
    return displayApts.filter((apt) => {
      const d = parseISO(apt.starts_at)
      if (from && d < from) return false
      if (to && d > to) return false
      if (filterStaff && apt.staff_id !== filterStaff) return false
      if (filterStatus === 'paid' && !apt.is_paid) return false
      if (filterStatus === 'unpaid' && apt.is_paid) return false
      return true
    })
  }, [displayApts, filterFrom, filterTo, filterStaff, filterStatus])

  const filteredTotal = filtered.reduce((s, a) => s + effectivePrice(a), 0)
  const filteredPaid = filtered
    .filter((a) => a.is_paid)
    .reduce((s, a) => s + effectivePrice(a), 0)
  const filteredUnpaid = filteredTotal - filteredPaid

  function handlePriceChange(id: string, price: number | null) {
    setOptimisticPrices((prev) => ({ ...prev, [id]: price }))
    startTransition(async () => {
      await updateAppointmentPrice(id, price)
    })
  }

  function handleTogglePaid(apt: RevenueAppointment) {
    const newPaid = !apt.is_paid
    setOptimisticPaid((prev) => ({ ...prev, [apt.id]: newPaid }))
    startTransition(async () => {
      await toggleAppointmentPaid(apt.id, newPaid)
    })
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Revenue</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Track payments and appointment revenue
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard
          label="Today"
          total={sumForPeriod(startToday, endToday)}
          paid={sumForPeriod(startToday, endToday, true)}
          accentIndex={0}
        />
        <SummaryCard
          label="This Week"
          total={sumForPeriod(startWeek, endToday)}
          paid={sumForPeriod(startWeek, endToday, true)}
          accentIndex={1}
        />
        <SummaryCard
          label="This Month"
          total={sumForPeriod(startMonth, endMonth)}
          paid={sumForPeriod(startMonth, endMonth, true)}
          accentIndex={2}
        />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">From</label>
          <input
            type="date"
            value={filterFrom}
            onChange={(e) => setFilterFrom(e.target.value)}
            className="h-9 rounded-md border px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">To</label>
          <input
            type="date"
            value={filterTo}
            onChange={(e) => setFilterTo(e.target.value)}
            className="h-9 rounded-md border px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Staff</label>
          <select
            value={filterStaff}
            onChange={(e) => setFilterStaff(e.target.value)}
            className="h-9 rounded-md border px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">All staff</option>
            {staffList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Payment</label>
          <select
            value={filterStatus}
            onChange={(e) =>
              setFilterStatus(e.target.value as 'all' | 'paid' | 'unpaid')
            }
            className="h-9 rounded-md border px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="all">All</option>
            <option value="paid">Paid only</option>
            <option value="unpaid">Unpaid only</option>
          </select>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 hover:bg-muted/40">
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Date</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Client</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Service</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Staff</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Price</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Paid</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="py-12 text-center text-muted-foreground"
                >
                  No appointments in this period
                </td>
              </tr>
            )}
            {filtered.map((apt) => (
              <tr key={apt.id} className="hover:bg-muted/30">
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                  {format(parseISO(apt.starts_at), 'dd MMM, HH:mm')}
                </td>
                <td className="px-4 py-3 font-medium">{apt.client_name}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {apt.service?.name ?? '—'}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {apt.staff?.name ?? '—'}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    apt.status === 'completed' ? 'bg-blue-50 text-blue-700'
                    : apt.status === 'confirmed' ? 'bg-emerald-50 text-emerald-700'
                    : apt.status === 'pending' ? 'bg-amber-50 text-amber-700'
                    : 'bg-muted text-muted-foreground'
                  }`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${
                      apt.status === 'completed' ? 'bg-blue-400'
                      : apt.status === 'confirmed' ? 'bg-emerald-500'
                      : apt.status === 'pending' ? 'bg-amber-400'
                      : 'bg-muted-foreground/40'
                    }`} />
                    {STATUS_LABELS[apt.status] ?? apt.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <PriceCell apt={apt} onSave={handlePriceChange} />
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => handleTogglePaid(apt)}
                    className={`flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors ${
                      apt.is_paid
                        ? 'border-emerald-500 bg-emerald-500 text-white'
                        : 'border-muted-foreground/30 text-transparent hover:border-emerald-400'
                    }`}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          {filtered.length > 0 && (
            <tfoot>
              <tr className="border-t-2 bg-muted/50">
                <td colSpan={5} className="px-4 py-3 font-medium">
                  {filtered.length} appointment
                  {filtered.length !== 1 ? 's' : ''}
                </td>
                <td className="px-4 py-3 font-bold">
                  {formatDH(filteredTotal)}
                </td>
                <td className="px-4 py-3">
                  <div className="text-xs">
                    <div className="font-medium text-emerald-600">
                      {formatDH(filteredPaid)} paid
                    </div>
                    {filteredUnpaid > 0 && (
                      <div className="text-amber-600">
                        {formatDH(filteredUnpaid)} unpaid
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
