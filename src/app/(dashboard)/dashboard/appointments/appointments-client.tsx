'use client'

import { useState, useTransition, useMemo, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  format,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  addDays,
  addWeeks,
  addMonths,
  addMinutes,
  subDays,
  subWeeks,
  subMonths,
  isSameDay,
  isSameMonth,
  isToday,
  parseISO,
  differenceInMinutes,
  getHours,
  getMinutes,
} from 'date-fns'
import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  pointerWithin,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Calendar,
  Clock,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import type { Service, Staff } from '@/types/database'
import { createAppointment, updateAppointment, deleteAppointment, searchClients, type ClientSummary } from './actions'
import { APPOINTMENT_DURATIONS } from './constants'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

// ─── Types ────────────────────────────────────────────────────────────────────

type AptStatus = 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show'

// Re-exported alias used by the page server component to type its
// search-param parser. Keeping the union in one place avoids drift between the
// chip UI, the URL contract, and the DB query.
export type AptStatusKey = AptStatus

export type ActiveFilter = {
  statuses: AptStatus[]
  fromStr: string  // YYYY-MM-DD
  toStr: string    // YYYY-MM-DD
  allStatusesSelected: boolean
}

type AppointmentRow = {
  id: string
  clinic_id: string
  client_id: string | null
  client_name: string
  client_email: string | null
  client_phone: string | null
  service_id: string
  staff_id: string | null
  starts_at: string
  ends_at: string
  status: AptStatus
  notes: string | null
  created_at: string
  service: { name: string; duration_minutes: number } | null
  staff: { name: string } | null
}

type ViewMode = 'schedule' | 'week' | 'month'

// ─── Constants ────────────────────────────────────────────────────────────────

const DAY_START = 7
const DAY_END = 21
const HOUR_HEIGHT = 64   // px per hour → 1px per minute at 64/60
const SNAP_MIN = 15       // snap drag to 15-minute increments
const HOURS = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i)

const STATUS_CFG: Record<
  AptStatus,
  { label: string; bg: string; text: string; border: string; badge: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  pending:   { label: 'Pending',   bg: 'bg-amber-100',   text: 'text-amber-900',   border: 'border-amber-400',   badge: 'outline' },
  confirmed: { label: 'Confirmed', bg: 'bg-emerald-100', text: 'text-emerald-900', border: 'border-emerald-500', badge: 'default' },
  cancelled: { label: 'Cancelled', bg: 'bg-slate-200',   text: 'text-slate-600',   border: 'border-slate-400',   badge: 'destructive' },
  completed: { label: 'Completed', bg: 'bg-blue-100',    text: 'text-blue-900',    border: 'border-blue-400',    badge: 'secondary' },
  no_show:   { label: 'No Show',   bg: 'bg-red-100',     text: 'text-red-900',     border: 'border-red-400',     badge: 'secondary' },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDatetimeLocal(date: Date): string {
  return format(date, "yyyy-MM-dd'T'HH:mm")
}

function aptTopPx(iso: string): number {
  const d = parseISO(iso)
  return Math.max(0, (getHours(d) + getMinutes(d) / 60 - DAY_START) * HOUR_HEIGHT)
}

function aptHeightPx(startsAt: string, endsAt: string): number {
  return Math.max(differenceInMinutes(parseISO(endsAt), parseISO(startsAt)), 20) / 60 * HOUR_HEIGHT
}

// ─── Overlap layout (within one column) ──────────────────────────────────────

type LaidOut = { apt: AppointmentRow; lane: number; totalLanes: number }

function computeLayout(apts: AppointmentRow[]): LaidOut[] {
  if (!apts.length) return []
  const sorted = [...apts].sort(
    (a, b) => parseISO(a.starts_at).getTime() - parseISO(b.starts_at).getTime(),
  )
  const laneEnds: Date[] = []
  const lanes = sorted.map((apt) => {
    const start = parseISO(apt.starts_at)
    const end = parseISO(apt.ends_at)
    let lane = laneEnds.findIndex((e) => e <= start)
    if (lane === -1) lane = laneEnds.length
    laneEnds[lane] = end
    return lane
  })
  const totalLanes = laneEnds.length
  return sorted.map((apt, i) => ({ apt, lane: lanes[i], totalLanes }))
}

// ─── Hour grid lines (shared) ─────────────────────────────────────────────────

function HourLines() {
  return (
    <>
      {HOURS.map((h) => (
        <div
          key={h}
          className="absolute left-0 right-0 border-t border-border/40 pointer-events-none"
          style={{ top: (h - DAY_START) * HOUR_HEIGHT }}
        />
      ))}
    </>
  )
}

// ─── Current time indicator ───────────────────────────────────────────────────

function CurrentTimeLine() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  const hours = getHours(now) + getMinutes(now) / 60
  if (hours < DAY_START || hours >= DAY_END) return null

  return (
    <div
      className="absolute left-0 right-0 z-20 pointer-events-none"
      style={{ top: (hours - DAY_START) * HOUR_HEIGHT }}
    >
      <div className="flex items-center">
        <span className="h-2 w-2 rounded-full bg-red-500 shrink-0 -ml-1 shadow-sm" />
        <span className="flex-1 border-t-2 border-red-500" />
      </div>
    </div>
  )
}

// ─── Draggable appointment block ──────────────────────────────────────────────

function DraggableApt({
  lo,
  onOpen,
}: {
  lo: LaidOut
  onOpen: (a: AppointmentRow) => void
}) {
  const { apt, lane, totalLanes } = lo
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: apt.id,
    data: { apt },
  })
  const cfg = STATUS_CFG[apt.status]
  const top = aptTopPx(apt.starts_at)
  const height = aptHeightPx(apt.starts_at, apt.ends_at)
  const pct = 100 / totalLanes

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        top,
        height,
        left: `${lane * pct + 1}%`,
        width: `${pct - 2}%`,
        zIndex: isDragging ? 50 : 10,
        touchAction: 'none',
      }}
      className={`absolute rounded border px-2 py-1.5 text-xs overflow-hidden
        cursor-grab active:cursor-grabbing select-none transition-opacity
        ${isDragging ? 'opacity-30' : 'hover:brightness-95'}
        ${cfg.bg} ${cfg.text} ${cfg.border}`}
      onClick={(e) => { e.stopPropagation(); if (!isDragging) onOpen(apt) }}
      {...attributes}
      {...listeners}
    >
      <p className="font-bold truncate leading-tight">{apt.client_name}</p>
      {height >= 38 && <p className="truncate leading-tight mt-0.5" style={{ opacity: 0.75 }}>{apt.service?.name ?? ''}</p>}
      {height >= 54 && (
        <p className="truncate leading-tight tabular-nums mt-0.5 text-[10px]" style={{ opacity: 0.65 }}>
          {format(parseISO(apt.starts_at), 'HH:mm')} – {format(parseISO(apt.ends_at), 'HH:mm')}
        </p>
      )}
    </div>
  )
}

// ─── Drag overlay (floating copy while dragging) ──────────────────────────────

function AptOverlay({ apt }: { apt: AppointmentRow }) {
  const cfg = STATUS_CFG[apt.status]
  const height = aptHeightPx(apt.starts_at, apt.ends_at)
  return (
    <div
      style={{ height, width: 160 }}
      className={`rounded border px-2 py-1.5 text-xs overflow-hidden shadow-2xl ring-2 ring-primary/30
        ${cfg.bg} ${cfg.text} ${cfg.border}`}
    >
      <p className="font-bold truncate leading-tight">{apt.client_name}</p>
      <p className="truncate leading-tight mt-0.5" style={{ opacity: 0.75 }}>{apt.service?.name ?? ''}</p>
      <p className="truncate leading-tight tabular-nums mt-0.5 text-[10px]" style={{ opacity: 0.65 }}>
        {format(parseISO(apt.starts_at), 'HH:mm')} – {format(parseISO(apt.ends_at), 'HH:mm')}
      </p>
    </div>
  )
}

// ─── Droppable staff column ───────────────────────────────────────────────────

function StaffColumn({
  staffId,
  label,
  date,
  colApts,
  onClickSlot,
  onClickApt,
}: {
  staffId: string | null
  label: string
  date: Date
  colApts: AppointmentRow[]
  onClickSlot: (date: Date) => void
  onClickApt: (apt: AppointmentRow) => void
}) {
  const id = `col-${staffId ?? 'unassigned'}`
  const { setNodeRef, isOver } = useDroppable({ id, data: { staffId } })
  const laidOut = useMemo(() => computeLayout(colApts), [colApts])

  function slotDate(hour: number): Date {
    const d = new Date(date)
    d.setHours(hour, 0, 0, 0)
    return d
  }

  return (
    <div className="flex-1 min-w-[110px] flex flex-col">
      {/* Sticky column header */}
      <div className={`sticky top-0 z-20 h-10 border-l border-b flex items-center justify-center px-2
        text-xs font-medium bg-card transition-colors ${isOver ? 'bg-primary/10 text-primary' : 'text-foreground'}`}
      >
        {label}
      </div>

      {/* Time grid body — droppable zone */}
      <div
        ref={setNodeRef}
        className={`relative border-l transition-colors ${isOver ? 'bg-primary/5' : ''}`}
        style={{ height: (DAY_END - DAY_START) * HOUR_HEIGHT }}
      >
        <HourLines />

        {/* Per-hour slot targets with hover "+" */}
        {HOURS.map((h) => (
          <div
            key={h}
            className="absolute left-0 right-0 z-[1] group/slot flex items-center justify-center"
            style={{ top: (h - DAY_START) * HOUR_HEIGHT, height: HOUR_HEIGHT }}
            onClick={() => onClickSlot(slotDate(h))}
          >
            <span className="pointer-events-none flex h-5 w-5 items-center justify-center rounded-full
              bg-primary/0 text-primary opacity-0 transition-opacity
              group-hover/slot:opacity-100 group-hover/slot:bg-primary/10">
              <Plus className="h-3 w-3" />
            </span>
          </div>
        ))}

        <CurrentTimeLine />

        {laidOut.map((lo) => (
          <DraggableApt key={lo.apt.id} lo={lo} onOpen={onClickApt} />
        ))}
      </div>
    </div>
  )
}

// ─── Scheduler view (staff columns + drag-and-drop) ───────────────────────────

function SchedulerView({
  date,
  appointments,
  staffList,
  onClickApt,
  onClickSlot,
}: {
  date: Date
  appointments: AppointmentRow[]
  staffList: Staff[]
  onClickApt: (apt: AppointmentRow) => void
  onClickSlot: (opts: { time: Date; staffId: string | null }) => void
}) {
  const router = useRouter()
  const [optimistic, setOptimistic] = useState<Map<string, Partial<AppointmentRow>>>(new Map())
  const [activeApt, setActiveApt] = useState<AppointmentRow | null>(null)
  const [isPending, startTransition] = useTransition()

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  )

  // Columns: active staff members + "Unassigned" at the end
  const columns = useMemo<Array<{ id: string | null; label: string }>>(() => [
    ...staffList.filter((s) => s.is_active).map((s) => ({ id: s.id, label: s.name })),
    { id: null, label: 'Unassigned' },
  ], [staffList])

  // Apply optimistic overrides for instant visual feedback
  const displayApts = useMemo(() =>
    appointments
      .filter((a) => isSameDay(parseISO(a.starts_at), date))
      .map((a) => {
        const o = optimistic.get(a.id)
        return o ? { ...a, ...o } : a
      }),
    [appointments, date, optimistic],
  )

  function handleDragStart({ active }: DragStartEvent) {
    setActiveApt((active.data.current as { apt: AppointmentRow } | undefined)?.apt ?? null)
  }

  function handleDragEnd({ active, over, delta }: DragEndEvent) {
    setActiveApt(null)
    if (!over) return

    const apt = (active.data.current as { apt: AppointmentRow } | undefined)?.apt
    if (!apt) return

    const newStaffId = (over.data.current as { staffId: string | null } | undefined)?.staffId ?? apt.staff_id
    // Snap vertical delta to SNAP_MIN increments
    const deltaMinutes = Math.round((delta.y / HOUR_HEIGHT * 60) / SNAP_MIN) * SNAP_MIN

    if (deltaMinutes === 0 && newStaffId === apt.staff_id) return

    const rawStart = addMinutes(parseISO(apt.starts_at), deltaMinutes)
    const dayFloor = new Date(rawStart); dayFloor.setHours(DAY_START, 0, 0, 0)
    const dayCeil  = new Date(rawStart); dayCeil.setHours(DAY_END - 1, 45, 0, 0)
    const clampedStart = rawStart < dayFloor ? dayFloor : rawStart > dayCeil ? dayCeil : rawStart
    const clampedEnd   = addMinutes(parseISO(apt.ends_at), deltaMinutes)

    // Optimistic update — show result immediately
    setOptimistic((prev) => new Map(prev).set(apt.id, {
      starts_at: clampedStart.toISOString(),
      ends_at:   clampedEnd.toISOString(),
      staff_id:  newStaffId,
    }))

    // Preserve the appointment's existing duration when rescheduling — the
    // server now expects an explicit `duration_minutes` and will recompute
    // ends_at from it.
    const aptDuration = differenceInMinutes(parseISO(apt.ends_at), parseISO(apt.starts_at))

    const fd = new FormData()
    fd.set('client_id',        apt.client_id ?? '')
    fd.set('client_name',      apt.client_name)
    fd.set('client_email',     apt.client_email ?? '')
    fd.set('client_phone',     apt.client_phone ?? '')
    fd.set('service_id',       apt.service_id)
    fd.set('staff_id',         newStaffId ?? '')
    fd.set('starts_at',        toDatetimeLocal(clampedStart))
    fd.set('duration_minutes', String(aptDuration))
    fd.set('status',           apt.status)
    fd.set('notes',            apt.notes ?? '')

    startTransition(async () => {
      const result = await updateAppointment(apt.id, fd)
      if (result.error) {
        toast.error(result.error)
        setOptimistic((prev) => { const m = new Map(prev); m.delete(apt.id); return m })
        return
      }
      toast.success('Appointment moved')
      router.refresh()
      setOptimistic(new Map())
    })
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveApt(null)}
    >
      <div className="overflow-y-auto overflow-x-auto" style={{ maxHeight: '68vh' }}>
        <div className="flex" style={{ minWidth: `${56 + columns.length * 110}px` }}>

          {/* Time label column */}
          <div className="w-14 shrink-0 flex flex-col">
            {/* Spacer matching the sticky header height */}
            <div className="sticky top-0 z-20 h-10 bg-card border-b" />
            {/* Hour labels */}
            <div className="relative" style={{ height: (DAY_END - DAY_START) * HOUR_HEIGHT }}>
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="absolute right-2 text-[11px] text-muted-foreground tabular-nums select-none"
                  style={{ top: (h - DAY_START) * HOUR_HEIGHT - 8 }}
                >
                  {h === 12 ? '12pm' : h < 12 ? `${h}am` : `${h - 12}pm`}
                </div>
              ))}
            </div>
          </div>

          {/* One column per staff + unassigned */}
          {columns.map((col) => (
            <StaffColumn
              key={col.id ?? 'unassigned'}
              staffId={col.id}
              label={col.label}
              date={date}
              colApts={displayApts.filter((a) =>
                col.id === null ? a.staff_id === null : a.staff_id === col.id,
              )}
              onClickSlot={(time) => onClickSlot({ time, staffId: col.id })}
              onClickApt={onClickApt}
            />
          ))}
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {activeApt ? <AptOverlay apt={activeApt} /> : null}
      </DragOverlay>
    </DndContext>
  )
}

// ─── Week view (unchanged from previous version) ─────────────────────────────

function WeekView({
  date,
  appointments,
  onClickApt,
  onClickSlot,
}: {
  date: Date
  appointments: AppointmentRow[]
  onClickApt: (a: AppointmentRow) => void
  onClickSlot: (d: Date) => void
}) {
  const weekStart = startOfWeek(date, { weekStartsOn: 1 })
  const days = eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) })

  function handleColClick(day: Date, e: React.MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('[data-apt]')) return
    const rect = e.currentTarget.getBoundingClientRect()
    const hour = Math.floor((e.clientY - rect.top) / HOUR_HEIGHT) + DAY_START
    const d = new Date(day); d.setHours(Math.min(hour, DAY_END - 1), 0, 0, 0)
    onClickSlot(d)
  }

  return (
    <div className="flex flex-col">
      <div className="flex border-b sticky top-0 bg-card z-20">
        <div className="w-14 shrink-0" />
        {days.map((day) => (
          <div key={day.toISOString()}
            className={`flex-1 min-w-[72px] text-center py-2 select-none ${isToday(day) ? 'bg-primary/5' : ''}`}
          >
            <p className={`text-[11px] font-medium ${isToday(day) ? 'text-primary' : 'text-muted-foreground'}`}>
              {format(day, 'EEE')}
            </p>
            <p className={`text-sm font-bold ${isToday(day) ? 'text-primary' : ''}`}>{format(day, 'd')}</p>
          </div>
        ))}
      </div>
      <div className="flex overflow-y-auto overflow-x-auto" style={{ maxHeight: '62vh' }}>
        <div className="w-14 shrink-0 relative" style={{ height: (DAY_END - DAY_START) * HOUR_HEIGHT }}>
          {HOURS.map((h) => (
            <div key={h} className="absolute right-2 text-[11px] text-muted-foreground tabular-nums select-none"
              style={{ top: (h - DAY_START) * HOUR_HEIGHT - 8 }}>
              {h === 12 ? '12pm' : h < 12 ? `${h}am` : `${h - 12}pm`}
            </div>
          ))}
        </div>
        {days.map((day) => {
          const dayApts = appointments.filter((a) => isSameDay(parseISO(a.starts_at), day))
          const laidOut = computeLayout(dayApts)
          return (
            <div key={day.toISOString()}
              className={`flex-1 min-w-[72px] relative border-l cursor-pointer ${isToday(day) ? 'bg-primary/5' : ''}`}
              style={{ height: (DAY_END - DAY_START) * HOUR_HEIGHT }}
              onClick={(e) => handleColClick(day, e)}
            >
              <HourLines />
              {laidOut.map((lo) => {
                const { apt, lane, totalLanes } = lo
                const cfg = STATUS_CFG[apt.status]
                const pct = 100 / totalLanes
                return (
                  <button key={apt.id} data-apt
                    onClick={(e) => { e.stopPropagation(); onClickApt(apt) }}
                    style={{ top: aptTopPx(apt.starts_at), height: aptHeightPx(apt.starts_at, apt.ends_at), left: `${lane * pct + 1}%`, width: `${pct - 2}%` }}
                    className={`absolute rounded border px-1 py-0.5 text-left text-[10px] overflow-hidden z-10 hover:brightness-95 ${cfg.bg} ${cfg.text} ${cfg.border}`}
                  >
                    <p className="font-semibold truncate leading-tight">{apt.client_name}</p>
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Month view ───────────────────────────────────────────────────────────────

function MonthView({
  date,
  appointments,
  onClickApt,
  onClickDay,
}: {
  date: Date
  appointments: AppointmentRow[]
  onClickApt: (a: AppointmentRow) => void
  onClickDay: (d: Date) => void
}) {
  const calStart = startOfWeek(startOfMonth(date), { weekStartsOn: 1 })
  const calEnd   = endOfWeek(endOfMonth(date), { weekStartsOn: 1 })
  const days     = eachDayOfInterval({ start: calStart, end: calEnd })

  return (
    <div>
      <div className="grid grid-cols-7 border-b">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d} className="py-2 text-center text-[11px] font-medium text-muted-foreground select-none">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const dayApts = appointments
            .filter((a) => isSameDay(parseISO(a.starts_at), day))
            .sort((a, b) => parseISO(a.starts_at).getTime() - parseISO(b.starts_at).getTime())
          const inMonth = isSameMonth(day, date)
          return (
            <div key={day.toISOString()} onClick={() => onClickDay(day)}
              className={`min-h-[90px] border-b border-r p-1 cursor-pointer hover:bg-muted/30 transition-colors ${!inMonth ? 'bg-muted/10' : ''}`}
            >
              <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium mb-0.5
                ${isToday(day) ? 'bg-primary text-primary-foreground' : inMonth ? 'text-foreground' : 'text-muted-foreground/40'}`}>
                {format(day, 'd')}
              </span>
              <div className="flex flex-col gap-0.5">
                {dayApts.slice(0, 3).map((apt) => {
                  const cfg = STATUS_CFG[apt.status]
                  return (
                    <button key={apt.id} onClick={(e) => { e.stopPropagation(); onClickApt(apt) }}
                      className={`w-full rounded px-1 py-0.5 text-left text-[10px] leading-tight truncate border ${cfg.bg} ${cfg.text} ${cfg.border}`}
                    >
                      <span className="font-semibold">{format(parseISO(apt.starts_at), 'HH:mm')}</span>{' '}{apt.client_name}
                    </button>
                  )
                })}
                {dayApts.length > 3 && (
                  <p className="text-[10px] text-muted-foreground pl-0.5">+{dayApts.length - 3} more</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Today summary bar ────────────────────────────────────────────────────────

function TodaySummary({
  appointments,
  onNew,
}: {
  appointments: AppointmentRow[]
  onNew: () => void
}) {
  const { todayCount, staffCount, nextApt } = useMemo(() => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const sorted = appointments
      .filter((a) => isSameDay(parseISO(a.starts_at), today))
      .sort((a, b) => parseISO(a.starts_at).getTime() - parseISO(b.starts_at).getTime())
    const staffIds = new Set(sorted.filter((a) => a.staff_id).map((a) => a.staff_id!))
    const next = sorted.find((a) => parseISO(a.starts_at) > now) ?? null
    return { todayCount: sorted.length, staffCount: staffIds.size, nextApt: next }
  }, [appointments])

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-card">
      <div className="flex flex-wrap gap-5">
        <div className="flex items-center gap-2 text-sm">
          <Calendar className="h-4 w-4 text-primary shrink-0" />
          <span className="font-semibold">{todayCount}</span>
          <span className="text-muted-foreground">{todayCount === 1 ? 'appointment' : 'appointments'} today</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Users className="h-4 w-4 text-blue-500 shrink-0" />
          <span className="font-semibold">{staffCount}</span>
          <span className="text-muted-foreground">staff working</span>
        </div>
        {nextApt ? (
          <div className="flex items-center gap-2 text-sm">
            <Clock className="h-4 w-4 text-amber-500 shrink-0" />
            <span className="text-muted-foreground">Next:</span>
            <span className="font-semibold">{format(parseISO(nextApt.starts_at), 'HH:mm')}</span>
            <span className="text-muted-foreground">—</span>
            <span>{nextApt.client_name}</span>
            {nextApt.service && (
              <span className="text-muted-foreground hidden sm:inline">· {nextApt.service.name}</span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4 shrink-0" />
            No upcoming appointments today
          </div>
        )}
      </div>
      <Button size="sm" onClick={onNew}>
        <Plus className="h-4 w-4" />
        New Appointment
      </Button>
    </div>
  )
}

// ─── Appointment detail dialog ────────────────────────────────────────────────

function AptDetail({
  apt,
  onEdit,
  onDelete,
  onClose,
}: {
  apt: AppointmentRow
  onEdit: () => void
  onDelete: () => void
  onClose: () => void
}) {
  const cfg = STATUS_CFG[apt.status]
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {apt.client_name}
            <span className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
              apt.status === 'confirmed' ? 'bg-emerald-50 text-emerald-700'
              : apt.status === 'pending' ? 'bg-amber-50 text-amber-700'
              : apt.status === 'completed' ? 'bg-blue-50 text-blue-700'
              : apt.status === 'cancelled' ? 'bg-muted text-muted-foreground'
              : 'bg-red-50 text-red-700'
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full ${
                apt.status === 'confirmed' ? 'bg-emerald-500'
                : apt.status === 'pending' ? 'bg-amber-400'
                : apt.status === 'completed' ? 'bg-blue-400'
                : apt.status === 'cancelled' ? 'bg-muted-foreground/40'
                : 'bg-red-400'
              }`} />
              {cfg.label}
            </span>
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="h-3.5 w-3.5 shrink-0" />
            {format(parseISO(apt.starts_at), 'EEEE, MMMM d · HH:mm')}
            {' – '}
            {format(parseISO(apt.ends_at), 'HH:mm')}
          </div>
          {apt.service && <p><span className="text-muted-foreground">Service:</span> {apt.service.name} ({apt.service.duration_minutes} min)</p>}
          {apt.staff  && <p><span className="text-muted-foreground">Staff:</span> {apt.staff.name}</p>}
          {apt.client_phone && <p><span className="text-muted-foreground">Phone:</span> {apt.client_phone}</p>}
          {apt.notes  && <p><span className="text-muted-foreground">Notes:</span> {apt.notes}</p>}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="destructive" size="sm" onClick={onDelete}>Delete</Button>
          <Button size="sm" onClick={onEdit}>Edit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Appointment form dialog ──────────────────────────────────────────────────

// ─── Smart client selector (search + create) ─────────────────────────────────

function ClientSelector({
  selectedId,
  name,
  onChange,
  onSelect,
  onClear,
  onCreateNew,
  inputRef,
}: {
  selectedId: string | null
  name: string
  onChange: (name: string) => void
  onSelect: (client: ClientSummary) => void
  onClear: () => void
  onCreateNew: () => void
  inputRef?: React.RefObject<HTMLInputElement | null>
}) {
  const [results, setResults] = useState<ClientSummary[]>([])
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const queryRef = useRef(name)
  queryRef.current = name

  // Debounced server-side search.
  useEffect(() => {
    if (selectedId) return
    const q = name.trim()
    if (q.length < 1) { setResults([]); setSearching(false); return }
    setSearching(true)
    const t = setTimeout(async () => {
      const r = await searchClients(q)
      if (queryRef.current.trim() !== q) return
      setResults(r.clients ?? [])
      setSearching(false)
    }, 200)
    return () => { clearTimeout(t) }
  }, [name, selectedId])

  // Close dropdown on outside click.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const trimmed = name.trim()
  const exactMatch = results.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())
  const showCreate = !selectedId && trimmed.length > 0 && !exactMatch

  return (
    <div ref={containerRef} className="relative">
      <div className="relative flex items-center">
        <Input
          ref={inputRef ?? undefined}
          value={name}
          onChange={(e) => {
            if (selectedId) onClear()
            onChange(e.target.value)
            setOpen(true)
          }}
          onFocus={() => { if (!selectedId) setOpen(true) }}
          placeholder="Search by name, email, or phone…"
          required
          className="pr-8"
          autoComplete="off"
        />
        {selectedId && (
          <button
            type="button"
            onClick={() => { onClear(); setOpen(true); inputRef?.current?.focus() }}
            className="absolute right-2 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Unlink client"
            title="Unlink client"
          >
            ×
          </button>
        )}
      </div>

      <p className={`mt-1 text-[11px] ${selectedId ? 'text-emerald-700' : 'text-muted-foreground'}`}>
        {selectedId
          ? '✓ Linked to existing client'
          : searching
          ? 'Searching…'
          : 'Pick an existing client or create a new one.'}
      </p>

      {open && !selectedId && (results.length > 0 || showCreate) && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-lg ring-1 ring-foreground/10">
          {results.length > 0 && (
            <ul className="max-h-56 overflow-y-auto py-1" role="listbox">
              {results.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => { onSelect(c); setOpen(false) }}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-muted transition-colors"
                    role="option"
                    aria-selected="false"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {c.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <p className="truncate font-medium leading-tight">{c.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {[c.email, c.phone].filter(Boolean).join(' · ') || '—'}
                      </p>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {showCreate && (
            <button
              type="button"
              onClick={() => { onCreateNew(); setOpen(false) }}
              className="flex w-full items-center gap-2 border-t bg-muted/40 px-3 py-2 text-left text-xs font-semibold text-foreground hover:bg-muted transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Create new client &quot;{trimmed}&quot;
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function AptFormDialog({
  open,
  onOpenChange,
  editing,
  defaultStartsAt,
  defaultStaffId,
  services,
  staffList,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  editing: AppointmentRow | null
  defaultStartsAt: string
  defaultStaffId: string | null
  services: Service[]
  staffList: Staff[]
  onSaved: () => void
}) {
  const [formError, setFormError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Controlled client fields. The server uses `client_id` as the source of truth
  // when present; otherwise it dedups by phone/email and creates a client.
  const [clientId, setClientId] = useState<string | null>(editing?.client_id ?? null)
  const [clientName, setClientName] = useState(editing?.client_name ?? '')
  const [clientEmail, setClientEmail] = useState(editing?.client_email ?? '')
  const [clientPhone, setClientPhone] = useState(editing?.client_phone ?? '')
  const emailInputRef = useRef<HTMLInputElement | null>(null)
  const nameInputRef = useRef<HTMLInputElement | null>(null)

  // Controlled time fields so we can render a live "10:00 → 11:00" preview.
  const initialDuration = (() => {
    if (editing) {
      const m = differenceInMinutes(parseISO(editing.ends_at), parseISO(editing.starts_at))
      // Snap to the nearest dropdown option so the select shows a sensible
      // default; the server still accepts any value, so editing legacy
      // appointments doesn't lose precision unless the user actually changes it.
      return APPOINTMENT_DURATIONS.reduce(
        (best, opt) => (Math.abs(opt - m) < Math.abs(best - m) ? opt : best),
        60 as number,
      )
    }
    return 60
  })()
  const [startsAt, setStartsAt] = useState<string>(
    editing ? toDatetimeLocal(parseISO(editing.starts_at)) : defaultStartsAt,
  )
  const [duration, setDuration] = useState<number>(initialDuration)

  useEffect(() => {
    if (!open) return
    setFormError(null)
    setClientId(editing?.client_id ?? null)
    setClientName(editing?.client_name ?? '')
    setClientEmail(editing?.client_email ?? '')
    setClientPhone(editing?.client_phone ?? '')
    setStartsAt(editing ? toDatetimeLocal(parseISO(editing.starts_at)) : defaultStartsAt)
    if (editing) {
      const m = differenceInMinutes(parseISO(editing.ends_at), parseISO(editing.starts_at))
      const snapped = APPOINTMENT_DURATIONS.reduce(
        (best, opt) => (Math.abs(opt - m) < Math.abs(best - m) ? opt : best),
        60 as number,
      )
      setDuration(snapped)
    } else {
      setDuration(60)
    }
  }, [open, editing?.id, editing?.client_id, editing?.client_name, editing?.client_email, editing?.client_phone, editing?.starts_at, editing?.ends_at, defaultStartsAt])

  const linked = !!clientId

  // Live time-range preview ("HH:mm → HH:mm"). parseISO handles the
  // datetime-local string ("yyyy-MM-ddTHH:mm") as a local time.
  const startDate = startsAt ? parseISO(startsAt) : null
  const endDate = startDate && !isNaN(startDate.getTime()) ? addMinutes(startDate, duration) : null
  const preview = startDate && endDate && !isNaN(startDate.getTime())
    ? `${format(startDate, 'HH:mm')} → ${format(endDate, 'HH:mm')}`
    : null

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setFormError(null)
    const fd = new FormData(e.currentTarget)
    // Email/phone inputs are disabled when a client is linked, so they won't
    // be in the FormData. Set them explicitly so the server has full context
    // (even though it'll override with the client record's values).
    fd.set('client_id', clientId ?? '')
    fd.set('client_name', clientName.trim())
    fd.set('client_email', clientEmail.trim())
    fd.set('client_phone', clientPhone.trim())
    fd.set('starts_at', startsAt)
    fd.set('duration_minutes', String(duration))
    startTransition(async () => {
      const result = editing
        ? await updateAppointment(editing.id, fd)
        : await createAppointment(fd)
      if (result.error) { setFormError(result.error); return }
      onOpenChange(false)
      toast.success(editing ? 'Appointment updated' : 'Appointment booked')
      onSaved()
    })
  }

  const effectiveStaffId = editing?.staff_id ?? defaultStaffId ?? ''

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!isPending) onOpenChange(v) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Appointment' : 'New Appointment'}</DialogTitle>
        </DialogHeader>

        <form key={`${editing?.id ?? 'new'}-${open}`} id="apt-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
          {formError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {formError}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label>Client *</Label>
            <ClientSelector
              selectedId={clientId}
              name={clientName}
              inputRef={nameInputRef}
              onChange={setClientName}
              onSelect={(c) => {
                setClientId(c.id)
                setClientName(c.name)
                setClientEmail(c.email ?? '')
                setClientPhone(c.phone ?? '')
              }}
              onClear={() => {
                setClientId(null)
              }}
              onCreateNew={() => {
                // Stays unlinked; server will create the client on submit.
                // Move focus to email so contact info can be filled in fast.
                setClientId(null)
                emailInputRef.current?.focus()
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="client_email">Email</Label>
              <Input
                ref={emailInputRef}
                id="client_email"
                type="email"
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                disabled={linked}
                placeholder="sara@example.com"
                title={linked ? 'Unlink the client to edit contact info' : undefined}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="client_phone">Phone</Label>
              <Input
                id="client_phone"
                type="tel"
                value={clientPhone}
                onChange={(e) => setClientPhone(e.target.value)}
                disabled={linked}
                placeholder="+212 6 00 00 00 00"
                title={linked ? 'Unlink the client to edit contact info' : undefined}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="service_id">Service *</Label>
              <select id="service_id" name="service_id" required defaultValue={editing?.service_id ?? ''}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring cursor-pointer">
                <option value="" disabled>Select service</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.duration_minutes} min)</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="staff_id">Staff member</Label>
              <select id="staff_id" name="staff_id" defaultValue={effectiveStaffId}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring cursor-pointer">
                <option value="">Unassigned</option>
                {staffList.filter((s) => s.is_active).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="starts_at">Start time *</Label>
              <Input
                id="starts_at"
                type="datetime-local"
                required
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="duration_minutes">Duration *</Label>
              <select
                id="duration_minutes"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring cursor-pointer"
              >
                {/* Editing a legacy appointment with a non-standard duration?
                    Surface it as an extra option so the dropdown reflects the
                    current saved value. */}
                {!APPOINTMENT_DURATIONS.includes(duration as typeof APPOINTMENT_DURATIONS[number]) && (
                  <option value={duration}>{duration} min (current)</option>
                )}
                {APPOINTMENT_DURATIONS.map((m) => (
                  <option key={m} value={m}>
                    {m < 60 ? `${m} min` : m === 60 ? '1 hour' : m % 60 === 0 ? `${m / 60} hours` : `${Math.floor(m / 60)}h ${m % 60}m`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {preview && (
            <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm">
              <span className="flex items-center gap-2 font-mono font-semibold tabular-nums text-foreground">
                <Clock className="h-3.5 w-3.5 text-primary" />
                {preview}
              </span>
              <span className="text-xs text-muted-foreground">{duration} min</span>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="status">Status</Label>
            <select id="status" name="status" defaultValue={editing?.status ?? 'pending'}
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring cursor-pointer">
              <option value="pending">Pending</option>
              <option value="confirmed">Confirmed</option>
              <option value="cancelled">Cancelled</option>
              <option value="completed">Completed</option>
              <option value="no_show">No Show</option>
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" name="notes" defaultValue={editing?.notes ?? ''} placeholder="Any special instructions…" />
          </div>
        </form>

        <DialogFooter>
          <Button variant="outline" type="button" disabled={isPending} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="apt-form" disabled={isPending}>
            {isPending ? 'Saving…' : editing ? 'Save Changes' : 'Book Appointment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Filter bar (server-side via URL search params) ──────────────────────────

const FILTER_STATUS_ORDER: AptStatus[] = ['pending', 'confirmed', 'completed', 'cancelled', 'no_show']
const ALL_FILTER_STATUSES: AptStatus[] = ['pending', 'confirmed', 'cancelled', 'completed', 'no_show']

function FilterBar({ filter }: { filter: ActiveFilter }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  function update(updates: Record<string, string | null>) {
    const usp = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') usp.delete(k)
      else usp.set(k, v)
    }
    const qs = usp.toString()
    startTransition(() => {
      router.push(qs ? `/dashboard/appointments?${qs}` : '/dashboard/appointments', { scroll: false })
    })
  }

  function setQuickView(kind: 'today' | 'week' | 'month') {
    const today = new Date()
    let from: Date
    let to: Date
    if (kind === 'today') {
      from = today
      to = today
    } else if (kind === 'week') {
      from = startOfWeek(today, { weekStartsOn: 1 })
      to = endOfWeek(today, { weekStartsOn: 1 })
    } else {
      from = startOfMonth(today)
      to = endOfMonth(today)
    }
    update({ from: format(from, 'yyyy-MM-dd'), to: format(to, 'yyyy-MM-dd') })
  }

  function toggleStatus(s: AptStatus) {
    let next: AptStatus[]
    if (filter.allStatusesSelected) {
      // First click peels this status out of the implicit "all".
      next = ALL_FILTER_STATUSES.filter((x) => x !== s)
    } else if (filter.statuses.includes(s)) {
      next = filter.statuses.filter((x) => x !== s)
    } else {
      next = [...filter.statuses, s]
    }
    // Empty selection → treat as "show all" (UX: avoid an unintentional
    // empty result from clicking off the last chip).
    if (next.length === 0 || next.length === ALL_FILTER_STATUSES.length) {
      update({ status: null })
    } else {
      update({ status: next.join(',') })
    }
  }

  function clearAll() {
    update({ status: null, from: null, to: null })
  }

  // Detect which quick-view (if any) the current range matches, for the
  // "active" pill style.
  const today = new Date()
  const todayStr = format(today, 'yyyy-MM-dd')
  const weekStartStr = format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const weekEndStr = format(endOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const monthStartStr = format(startOfMonth(today), 'yyyy-MM-dd')
  const monthEndStr = format(endOfMonth(today), 'yyyy-MM-dd')

  const activeQuick: 'today' | 'week' | 'month' | null =
    filter.fromStr === todayStr && filter.toStr === todayStr
      ? 'today'
      : filter.fromStr === weekStartStr && filter.toStr === weekEndStr
      ? 'week'
      : filter.fromStr === monthStartStr && filter.toStr === monthEndStr
      ? 'month'
      : null

  const isDefault = activeQuick === 'month' && filter.allStatusesSelected

  return (
    <div className="rounded-2xl border border-border bg-card p-3 shadow-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* Quick views */}
        <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-background p-0.5">
          {(['today', 'week', 'month'] as const).map((k) => {
            const active = activeQuick === k
            return (
              <button
                key={k}
                type="button"
                onClick={() => setQuickView(k)}
                disabled={isPending}
                aria-pressed={active}
                className={`h-7 rounded-md px-2.5 text-xs font-medium transition-colors disabled:opacity-60 ${
                  active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-foreground hover:bg-muted'
                }`}
              >
                {k === 'today' ? 'Today' : k === 'week' ? 'This week' : 'This month'}
              </button>
            )
          })}
        </div>

        <div className="hidden h-6 w-px bg-border sm:block" aria-hidden="true" />

        {/* Date range */}
        <div className="flex items-center gap-1.5 text-xs">
          <label className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">From</span>
            <input
              type="date"
              value={filter.fromStr}
              max={filter.toStr || undefined}
              disabled={isPending}
              onChange={(e) => update({ from: e.target.value || null })}
              className="h-7 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring/40 disabled:opacity-60"
            />
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">To</span>
            <input
              type="date"
              value={filter.toStr}
              min={filter.fromStr || undefined}
              disabled={isPending}
              onChange={(e) => update({ to: e.target.value || null })}
              className="h-7 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring/40 disabled:opacity-60"
            />
          </label>
        </div>

        <div className="hidden h-6 w-px bg-border sm:block" aria-hidden="true" />

        {/* Status chips */}
        <div className="flex flex-wrap items-center gap-1">
          {FILTER_STATUS_ORDER.map((s) => {
            const cfg = STATUS_CFG[s]
            const active = filter.allStatusesSelected || filter.statuses.includes(s)
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleStatus(s)}
                disabled={isPending}
                aria-pressed={active}
                className={`h-7 rounded-full px-2.5 text-[11px] font-semibold transition-all disabled:opacity-60 ${
                  active
                    ? `${cfg.bg} ${cfg.text} ring-1 ring-inset ${cfg.border}`
                    : 'border border-input bg-background text-muted-foreground hover:bg-muted'
                }`}
              >
                {cfg.label}
              </button>
            )
          })}
        </div>

        {!isDefault && (
          <button
            type="button"
            onClick={clearAll}
            disabled={isPending}
            className="ml-auto inline-flex h-7 items-center rounded-md px-2.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-60"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────

interface Props {
  appointments: AppointmentRow[]
  services: Service[]
  staffList: Staff[]
  filter: ActiveFilter
}

export function AppointmentsClient({ appointments, services, staffList, filter }: Props) {
  const router = useRouter()
  const [view, setView] = useState<ViewMode>('schedule')
  const [currentDate, setCurrentDate] = useState(() => new Date())
  const [formOpen, setFormOpen] = useState(false)
  const [detailApt, setDetailApt] = useState<AppointmentRow | null>(null)
  const [editingApt, setEditingApt] = useState<AppointmentRow | null>(null)
  const [defaultStartsAt, setDefaultStartsAt] = useState('')
  const [defaultStaffId, setDefaultStaffId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function navigate(dir: -1 | 1) {
    setCurrentDate((d) => {
      if (view === 'schedule') return dir === 1 ? addDays(d, 1) : subDays(d, 1)
      if (view === 'week')     return dir === 1 ? addWeeks(d, 1) : subWeeks(d, 1)
      return dir === 1 ? addMonths(d, 1) : subMonths(d, 1)
    })
  }

  function openCreate(opts?: { time?: Date; staffId?: string | null }) {
    setEditingApt(null)
    setDefaultStartsAt(opts?.time ? toDatetimeLocal(opts.time) : toDatetimeLocal(new Date()))
    setDefaultStaffId(opts?.staffId ?? null)
    setFormOpen(true)
  }

  function openEdit(apt: AppointmentRow) {
    setDetailApt(null)
    setEditingApt(apt)
    setDefaultStartsAt('')
    setDefaultStaffId(null)
    setFormOpen(true)
  }

  function handleDelete(apt: AppointmentRow) {
    if (!confirm(`Delete appointment for "${apt.client_name}"?`)) return
    setDetailApt(null)
    startTransition(async () => {
      const result = await deleteAppointment(apt.id)
      if (result.error) { toast.error(result.error); return }
      toast.success('Appointment deleted')
      router.refresh()
    })
  }

  function headerLabel() {
    if (view === 'schedule') return format(currentDate, 'EEEE, MMMM d, yyyy')
    if (view === 'week') {
      const ws = startOfWeek(currentDate, { weekStartsOn: 1 })
      return `${format(ws, 'MMM d')} – ${format(addDays(ws, 6), 'MMM d, yyyy')}`
    }
    return format(currentDate, 'MMMM yyyy')
  }

  const VIEW_LABELS: Record<ViewMode, string> = {
    schedule: 'Schedule',
    week: 'Week',
    month: 'Month',
  }

  return (
    <div className="flex flex-col gap-4">
      <FilterBar filter={filter} />
      <TodaySummary appointments={appointments} onNew={() => openCreate()} />

      <div className="rounded-2xl border border-border bg-card shadow-card overflow-hidden">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          {/* View switcher */}
          <div className="flex rounded-lg border text-sm overflow-hidden">
            {(Object.keys(VIEW_LABELS) as ViewMode[]).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1.5 transition-colors focus:outline-none ${view === v ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
                {VIEW_LABELS[v]}
              </button>
            ))}
          </div>

          {/* Navigation */}
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="hidden sm:block min-w-0 w-56 text-center text-sm font-medium truncate">
              {headerLabel()}
            </span>
            <Button variant="ghost" size="icon" onClick={() => navigate(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setCurrentDate(new Date())}>
              Today
            </Button>
          </div>
        </div>

        {/* Mobile: header label */}
        <div className="sm:hidden border-b px-4 py-2 text-sm font-medium">{headerLabel()}</div>

        {/* Calendar body */}
        {view === 'schedule' && (
          <SchedulerView
            date={currentDate}
            appointments={appointments}
            staffList={staffList}
            onClickApt={(apt) => setDetailApt(apt)}
            onClickSlot={({ time, staffId }) => openCreate({ time, staffId })}
          />
        )}
        {view === 'week' && (
          <WeekView
            date={currentDate}
            appointments={appointments}
            onClickApt={(apt) => setDetailApt(apt)}
            onClickSlot={(d) => openCreate({ time: d })}
          />
        )}
        {view === 'month' && (
          <MonthView
            date={currentDate}
            appointments={appointments}
            onClickApt={(apt) => setDetailApt(apt)}
            onClickDay={(d) => { setCurrentDate(d); setView('schedule') }}
          />
        )}
      </div>

      {detailApt && (
        <AptDetail
          apt={detailApt}
          onEdit={() => openEdit(detailApt)}
          onDelete={() => handleDelete(detailApt)}
          onClose={() => setDetailApt(null)}
        />
      )}

      <AptFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editingApt}
        defaultStartsAt={defaultStartsAt}
        defaultStaffId={defaultStaffId}
        services={services}
        staffList={staffList}
        onSaved={() => router.refresh()}
      />
    </div>
  )
}
