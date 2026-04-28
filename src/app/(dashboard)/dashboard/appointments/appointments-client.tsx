'use client'

import { useState, useTransition, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
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
import { createAppointment, updateAppointment, deleteAppointment } from './actions'
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

type AppointmentRow = {
  id: string
  clinic_id: string
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

    const fd = new FormData()
    fd.set('client_name',  apt.client_name)
    fd.set('client_email', apt.client_email ?? '')
    fd.set('client_phone', apt.client_phone ?? '')
    fd.set('service_id',   apt.service_id)
    fd.set('staff_id',     newStaffId ?? '')
    fd.set('starts_at',    toDatetimeLocal(clampedStart))
    fd.set('status',       apt.status)
    fd.set('notes',        apt.notes ?? '')

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
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4 shadow-sm">
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

  useEffect(() => { if (open) setFormError(null) }, [open, editing?.id])

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setFormError(null)
    const fd = new FormData(e.currentTarget)
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
            <Label htmlFor="client_name">Client name *</Label>
            <Input id="client_name" name="client_name" required defaultValue={editing?.client_name} placeholder="Sara Benali" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="client_email">Email</Label>
              <Input id="client_email" name="client_email" type="email" defaultValue={editing?.client_email ?? ''} placeholder="sara@example.com" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="client_phone">Phone</Label>
              <Input id="client_phone" name="client_phone" type="tel" defaultValue={editing?.client_phone ?? ''} placeholder="+212 6 00 00 00 00" />
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
              <Label htmlFor="starts_at">Date & time *</Label>
              <Input id="starts_at" name="starts_at" type="datetime-local" required
                defaultValue={editing ? toDatetimeLocal(parseISO(editing.starts_at)) : defaultStartsAt} />
            </div>
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

// ─── Main export ──────────────────────────────────────────────────────────────

interface Props {
  appointments: AppointmentRow[]
  services: Service[]
  staffList: Staff[]
}

export function AppointmentsClient({ appointments, services, staffList }: Props) {
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
      <TodaySummary appointments={appointments} onNew={() => openCreate()} />

      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
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
