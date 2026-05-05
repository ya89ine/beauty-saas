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
  ChevronDown,
  Plus,
  Calendar,
  Clock,
  Users,
  Search,
  Mail,
  Phone,
  X,
  UserPlus,
} from 'lucide-react'
import { toast } from 'sonner'
import type { Service, Staff } from '@/types/database'
import { createAppointment, updateAppointment, deleteAppointment, searchClients, type ClientSummary } from './actions'
import { APPOINTMENT_DURATIONS } from './constants'
import { getServiceColor, getServiceHex, type ServiceColor } from '@/lib/service-colors'
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

// Working hours displayed on the calendar grid. Hours from DAY_START up to
// (but not including) DAY_END are rendered as full slots; an extra closing
// label is drawn at DAY_END so the grid has a clean lower boundary.
const DAY_START = 8
const DAY_END = 20
const HOUR_HEIGHT = 64   // px per hour → 1px per minute at 64/60
const SLOT_MIN = 15       // calendar slot granularity (also drag snap)
const SNAP_MIN = SLOT_MIN
const SLOT_HEIGHT = HOUR_HEIGHT / (60 / SLOT_MIN)  // 16px per 15-min slot
const HOURS = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i)
// Quarter-hour offsets (in hours) used to draw the lighter grid lines and to
// mount slot click targets for :15/:30/:45.
const QUARTERS: ReadonlyArray<number> = [0, 0.25, 0.5, 0.75]
// Vertical breathing room above the first hour line and below the last so the
// time labels never get clipped against the sticky header / column border.
const TIMELINE_TOP_PAD = 12
const TIMELINE_BOTTOM_PAD = 16
const TIMELINE_HEIGHT = (DAY_END - DAY_START) * HOUR_HEIGHT + TIMELINE_TOP_PAD + TIMELINE_BOTTOM_PAD

// 24h hour label, e.g. 8 → "08:00".
function fmtHour(h: number): string {
  return `${String(h).padStart(2, '0')}:00`
}

// Round a Date down to the nearest 15-minute mark.
function snapToSlot(d: Date): Date {
  const out = new Date(d)
  out.setMinutes(Math.floor(out.getMinutes() / SLOT_MIN) * SLOT_MIN, 0, 0)
  return out
}

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
  return Math.max(0, TIMELINE_TOP_PAD + (getHours(d) + getMinutes(d) / 60 - DAY_START) * HOUR_HEIGHT)
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
      {/* Top boundary of the working-hours window */}
      <div
        className="absolute left-0 right-0 border-t border-border pointer-events-none"
        style={{ top: TIMELINE_TOP_PAD }}
      />
      {HOURS.map((h, idx) => (
        <div key={`h-${h}`}>
          {/* Skip the redundant 0-offset line for the first hour — the top
              boundary above already covers it. */}
          {idx > 0 && (
            <div
              className="absolute left-0 right-0 border-t border-border/50 pointer-events-none"
              style={{ top: TIMELINE_TOP_PAD + (h - DAY_START) * HOUR_HEIGHT }}
            />
          )}
          {/* Lighter quarter-hour lines (skip the on-the-hour line — already drawn) */}
          {QUARTERS.slice(1).map((q) => (
            <div
              key={`q-${h}-${q}`}
              className="absolute left-0 right-0 border-t border-dashed border-border/25 pointer-events-none"
              style={{ top: TIMELINE_TOP_PAD + (h - DAY_START + q) * HOUR_HEIGHT }}
            />
          ))}
        </div>
      ))}
      {/* Bottom boundary at DAY_END */}
      <div
        className="absolute left-0 right-0 border-t border-border pointer-events-none"
        style={{ top: TIMELINE_TOP_PAD + (DAY_END - DAY_START) * HOUR_HEIGHT }}
      />
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
      style={{ top: TIMELINE_TOP_PAD + (hours - DAY_START) * HOUR_HEIGHT }}
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
  color,
  onOpen,
}: {
  lo: LaidOut
  color: ServiceColor
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
  const cancelled = apt.status === 'cancelled'

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
        backgroundColor: cancelled ? undefined : color.soft,
        borderColor: cancelled ? undefined : color.border,
        color: cancelled ? undefined : color.textOnSoft,
        borderLeftWidth: 4,
      }}
      className={`absolute rounded border px-2 py-1.5 text-xs overflow-hidden
        cursor-grab active:cursor-grabbing select-none transition-opacity
        ${isDragging ? 'opacity-30' : 'hover:brightness-95'}
        ${cancelled ? `${cfg.bg} ${cfg.text} ${cfg.border} line-through opacity-70` : ''}`}
      onClick={(e) => { e.stopPropagation(); if (!isDragging) onOpen(apt) }}
      {...attributes}
      {...listeners}
    >
      <p className="font-bold truncate leading-tight">{apt.client_name}</p>
      {height >= 38 && <p className="truncate leading-tight mt-0.5" style={{ opacity: 0.85 }}>{apt.service?.name ?? ''}</p>}
      {height >= 54 && (
        <p className="truncate leading-tight tabular-nums mt-0.5 text-[10px]" style={{ opacity: 0.7 }}>
          {format(parseISO(apt.starts_at), 'HH:mm')} – {format(parseISO(apt.ends_at), 'HH:mm')}
        </p>
      )}
    </div>
  )
}

// ─── Drag overlay (floating copy while dragging) ──────────────────────────────

function AptOverlay({ apt, color }: { apt: AppointmentRow; color: ServiceColor }) {
  const cfg = STATUS_CFG[apt.status]
  const height = aptHeightPx(apt.starts_at, apt.ends_at)
  const cancelled = apt.status === 'cancelled'
  return (
    <div
      style={{
        height,
        width: 160,
        backgroundColor: cancelled ? undefined : color.soft,
        borderColor: cancelled ? undefined : color.border,
        color: cancelled ? undefined : color.textOnSoft,
        borderLeftWidth: 4,
      }}
      className={`rounded border px-2 py-1.5 text-xs overflow-hidden shadow-2xl ring-2 ring-primary/30
        ${cancelled ? `${cfg.bg} ${cfg.text} ${cfg.border}` : ''}`}
    >
      <p className="font-bold truncate leading-tight">{apt.client_name}</p>
      <p className="truncate leading-tight mt-0.5" style={{ opacity: 0.85 }}>{apt.service?.name ?? ''}</p>
      <p className="truncate leading-tight tabular-nums mt-0.5 text-[10px]" style={{ opacity: 0.7 }}>
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
  colorFor,
  onClickSlot,
  onClickApt,
}: {
  staffId: string | null
  label: string
  date: Date
  colApts: AppointmentRow[]
  colorFor: (serviceId: string) => ServiceColor
  onClickSlot: (date: Date) => void
  onClickApt: (apt: AppointmentRow) => void
}) {
  const id = `col-${staffId ?? 'unassigned'}`
  const { setNodeRef, isOver } = useDroppable({ id, data: { staffId } })
  const laidOut = useMemo(() => computeLayout(colApts), [colApts])

  function slotDate(hour: number, minute: number): Date {
    const d = new Date(date)
    d.setHours(hour, minute, 0, 0)
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
        style={{ height: TIMELINE_HEIGHT }}
      >
        <HourLines />

        {/* Per-15-min slot targets with hover "+" */}
        {HOURS.flatMap((h) =>
          QUARTERS.map((q) => {
            const minute = Math.round(q * 60)
            return (
              <div
                key={`${h}-${minute}`}
                className="absolute left-0 right-0 z-[1] group/slot flex items-center justify-center"
                style={{ top: TIMELINE_TOP_PAD + (h - DAY_START + q) * HOUR_HEIGHT, height: SLOT_HEIGHT }}
                onClick={() => onClickSlot(slotDate(h, minute))}
              >
                <span className="pointer-events-none flex h-4 w-4 items-center justify-center rounded-full
                  bg-primary/0 text-primary opacity-0 transition-opacity
                  group-hover/slot:opacity-100 group-hover/slot:bg-primary/10">
                  <Plus className="h-2.5 w-2.5" />
                </span>
              </div>
            )
          }),
        )}

        <CurrentTimeLine />

        {laidOut.map((lo) => (
          <DraggableApt key={lo.apt.id} lo={lo} color={colorFor(lo.apt.service_id)} onOpen={onClickApt} />
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
  colorFor,
  onClickApt,
  onClickSlot,
}: {
  date: Date
  appointments: AppointmentRow[]
  staffList: Staff[]
  colorFor: (serviceId: string) => ServiceColor
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
        <div className="flex" style={{ minWidth: `${64 + columns.length * 110}px` }}>

          {/* Time label column */}
          <div className="w-16 shrink-0 flex flex-col">
            {/* Spacer matching the sticky header height */}
            <div className="sticky top-0 z-20 h-10 bg-card border-b" />
            {/* Hour + quarter-hour labels */}
            <div className="relative" style={{ height: TIMELINE_HEIGHT }}>
              {HOURS.flatMap((h) => [
                <div
                  key={`h-${h}`}
                  className="absolute right-2 text-[11px] font-semibold text-foreground tabular-nums select-none"
                  style={{ top: TIMELINE_TOP_PAD + (h - DAY_START) * HOUR_HEIGHT - 7 }}
                >
                  {fmtHour(h)}
                </div>,
                ...QUARTERS.slice(1).map((q) => (
                  <div
                    key={`q-${h}-${q}`}
                    className="absolute right-2 text-[9px] text-muted-foreground/60 tabular-nums select-none"
                    style={{ top: TIMELINE_TOP_PAD + (h - DAY_START + q) * HOUR_HEIGHT - 5 }}
                  >
                    :{Math.round(q * 60).toString().padStart(2, '0')}
                  </div>
                )),
              ])}
              {/* Closing label at DAY_END so the grid has a clear "end of day". */}
              <div
                className="absolute right-2 text-[11px] font-semibold text-foreground tabular-nums select-none"
                style={{ top: TIMELINE_TOP_PAD + (DAY_END - DAY_START) * HOUR_HEIGHT - 7 }}
              >
                {fmtHour(DAY_END)}
              </div>
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
              colorFor={colorFor}
              onClickSlot={(time) => onClickSlot({ time, staffId: col.id })}
              onClickApt={onClickApt}
            />
          ))}
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {activeApt ? <AptOverlay apt={activeApt} color={colorFor(activeApt.service_id)} /> : null}
      </DragOverlay>
    </DndContext>
  )
}

// ─── Week view (unchanged from previous version) ─────────────────────────────

function WeekView({
  date,
  appointments,
  colorFor,
  onClickApt,
  onClickSlot,
}: {
  date: Date
  appointments: AppointmentRow[]
  colorFor: (serviceId: string) => ServiceColor
  onClickApt: (a: AppointmentRow) => void
  onClickSlot: (d: Date) => void
}) {
  const weekStart = startOfWeek(date, { weekStartsOn: 1 })
  const days = eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) })

  function handleColClick(day: Date, e: React.MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('[data-apt]')) return
    const rect = e.currentTarget.getBoundingClientRect()
    // Account for the top padding inside the grid; clicks above the first
    // hour line (or below the last) are clamped to a valid working slot.
    const yInGrid = e.clientY - rect.top - TIMELINE_TOP_PAD
    if (yInGrid < 0) return
    const minutesFromDayStart = Math.floor(yInGrid / SLOT_HEIGHT) * SLOT_MIN
    const totalMinutes = DAY_START * 60 + minutesFromDayStart
    if (totalMinutes >= DAY_END * 60) return
    const hour = Math.floor(totalMinutes / 60)
    const minute = totalMinutes % 60
    const d = new Date(day); d.setHours(hour, minute, 0, 0)
    onClickSlot(d)
  }

  return (
    <div className="flex flex-col">
      <div className="flex border-b sticky top-0 bg-card z-20">
        <div className="w-16 shrink-0" />
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
        <div className="w-16 shrink-0 relative" style={{ height: TIMELINE_HEIGHT }}>
          {HOURS.flatMap((h) => [
            <div key={`h-${h}`} className="absolute right-2 text-[11px] font-semibold text-foreground tabular-nums select-none"
              style={{ top: TIMELINE_TOP_PAD + (h - DAY_START) * HOUR_HEIGHT - 7 }}>
              {fmtHour(h)}
            </div>,
            ...QUARTERS.slice(1).map((q) => (
              <div key={`q-${h}-${q}`} className="absolute right-2 text-[9px] text-muted-foreground/60 tabular-nums select-none"
                style={{ top: TIMELINE_TOP_PAD + (h - DAY_START + q) * HOUR_HEIGHT - 5 }}>
                :{Math.round(q * 60).toString().padStart(2, '0')}
              </div>
            )),
          ])}
          {/* Closing label — keeps the day's end visible at the bottom edge. */}
          <div className="absolute right-2 text-[11px] font-semibold text-foreground tabular-nums select-none"
            style={{ top: TIMELINE_TOP_PAD + (DAY_END - DAY_START) * HOUR_HEIGHT - 7 }}>
            {fmtHour(DAY_END)}
          </div>
        </div>
        {days.map((day) => {
          const dayApts = appointments.filter((a) => isSameDay(parseISO(a.starts_at), day))
          const laidOut = computeLayout(dayApts)
          return (
            <div key={day.toISOString()}
              className={`flex-1 min-w-[72px] relative border-l cursor-pointer ${isToday(day) ? 'bg-primary/5' : ''}`}
              style={{ height: TIMELINE_HEIGHT }}
              onClick={(e) => handleColClick(day, e)}
            >
              <HourLines />
              {laidOut.map((lo) => {
                const { apt, lane, totalLanes } = lo
                const cfg = STATUS_CFG[apt.status]
                const pct = 100 / totalLanes
                const cancelled = apt.status === 'cancelled'
                const c = colorFor(apt.service_id)
                return (
                  <button key={apt.id} data-apt
                    onClick={(e) => { e.stopPropagation(); onClickApt(apt) }}
                    style={{
                      top: aptTopPx(apt.starts_at),
                      height: aptHeightPx(apt.starts_at, apt.ends_at),
                      left: `${lane * pct + 1}%`,
                      width: `${pct - 2}%`,
                      backgroundColor: cancelled ? undefined : c.soft,
                      borderColor: cancelled ? undefined : c.border,
                      color: cancelled ? undefined : c.textOnSoft,
                      borderLeftWidth: 3,
                    }}
                    className={`absolute rounded border px-1 py-0.5 text-left text-[10px] overflow-hidden z-10 hover:brightness-95 ${
                      cancelled ? `${cfg.bg} ${cfg.text} ${cfg.border} line-through opacity-70` : ''
                    }`}
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
  colorFor,
  onClickApt,
  onClickDay,
}: {
  date: Date
  appointments: AppointmentRow[]
  colorFor: (serviceId: string) => ServiceColor
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
                  const cancelled = apt.status === 'cancelled'
                  const c = colorFor(apt.service_id)
                  return (
                    <button key={apt.id} onClick={(e) => { e.stopPropagation(); onClickApt(apt) }}
                      style={{
                        backgroundColor: cancelled ? undefined : c.soft,
                        borderColor: cancelled ? undefined : c.border,
                        color: cancelled ? undefined : c.textOnSoft,
                        borderLeftWidth: 3,
                      }}
                      className={`w-full rounded px-1 py-0.5 text-left text-[10px] leading-tight truncate border ${
                        cancelled ? `${cfg.bg} ${cfg.text} ${cfg.border} line-through opacity-70` : ''
                      }`}
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

// ─── Appointment form dialog ──────────────────────────────────────────────────

// ─── Smart client selector (search + create) ─────────────────────────────────

// Highlight every case-insensitive occurrence of `query` inside `text`. Returns
// React fragments so the matched substring can be wrapped in a <mark>. Empty
// query → render text as-is.
function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text
  const lower = text.toLowerCase()
  const q = query.toLowerCase()
  const out: React.ReactNode[] = []
  let i = 0
  let key = 0
  while (i < text.length) {
    const idx = lower.indexOf(q, i)
    if (idx === -1) { out.push(text.slice(i)); break }
    if (idx > i) out.push(text.slice(i, idx))
    out.push(
      <mark key={key++} className="rounded bg-amber-200/70 px-0.5 text-foreground">
        {text.slice(idx, idx + q.length)}
      </mark>,
    )
    i = idx + q.length
  }
  return <>{out}</>
}

function ClientSelector({
  selectedId,
  name,
  clients,
  onChange,
  onSelect,
  onClear,
  onCreateNew,
  inputRef,
}: {
  selectedId: string | null
  name: string
  clients: ClientSummary[]
  onChange: (name: string) => void
  onSelect: (client: ClientSummary) => void
  onClear: () => void
  onCreateNew: () => void
  inputRef?: React.RefObject<HTMLInputElement | null>
}) {
  const [remoteResults, setRemoteResults] = useState<ClientSummary[]>([])
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)
  const queryRef = useRef(name)
  queryRef.current = name

  // Local filter on the pre-loaded clinic clients — instant, no round-trip.
  // The remote `searchClients` call below is a backstop in case the typed
  // query touches a client that isn't in the cached list (e.g. a row added by
  // another device since this page was rendered).
  const trimmed = name.trim()
  const lower = trimmed.toLowerCase()
  const localMatches = useMemo<ClientSummary[]>(() => {
    if (selectedId) return []
    if (!trimmed) return clients.slice(0, 50)
    return clients
      .filter((c) =>
        c.name.toLowerCase().includes(lower) ||
        (c.email?.toLowerCase().includes(lower) ?? false) ||
        (c.phone?.includes(trimmed) ?? false),
      )
      .slice(0, 50)
  }, [clients, lower, trimmed, selectedId])

  // Merge local + remote, dedup by id, local first (cheaper / freshest).
  const results = useMemo<ClientSummary[]>(() => {
    if (selectedId) return []
    const seen = new Set<string>()
    const out: ClientSummary[] = []
    for (const c of localMatches) {
      if (!seen.has(c.id)) { seen.add(c.id); out.push(c) }
    }
    for (const c of remoteResults) {
      if (!seen.has(c.id)) { seen.add(c.id); out.push(c) }
    }
    return out
  }, [localMatches, remoteResults, selectedId])

  // Debounced server-side search — only when we have a query the local list
  // doesn't already satisfy. Empty queries just show the cached list.
  useEffect(() => {
    if (selectedId) return
    const q = name.trim()
    if (q.length < 1) { setRemoteResults([]); setSearching(false); return }
    if (localMatches.length >= 8) { setRemoteResults([]); setSearching(false); return }
    setSearching(true)
    const t = setTimeout(async () => {
      const r = await searchClients(q)
      if (queryRef.current.trim() !== q) return
      setRemoteResults(r.clients ?? [])
      setSearching(false)
    }, 200)
    return () => { clearTimeout(t) }
  }, [name, selectedId, localMatches.length])

  // Close dropdown on outside click.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const exactMatch = results.some((c) => c.name.toLowerCase() === lower)
  const showCreate = !selectedId && trimmed.length > 0 && !exactMatch
  // Total selectable rows = client matches + an optional "create new" row that
  // sits at the end. Keyboard nav indexes into this combined list.
  const totalRows = results.length + (showCreate ? 1 : 0)

  // Keep the active index in range when results change (typing narrows the list).
  useEffect(() => {
    setActiveIndex((i) => (totalRows === 0 ? 0 : Math.min(i, totalRows - 1)))
  }, [totalRows])

  // Auto-scroll the active row into view so keyboard navigation never goes
  // off-screen in the dropdown.
  useEffect(() => {
    if (!open) return
    const ul = listRef.current
    if (!ul) return
    const node = ul.querySelector<HTMLElement>(`[data-row-index="${activeIndex}"]`)
    if (node) node.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  function commitActive() {
    if (totalRows === 0) return
    if (activeIndex < results.length) {
      onSelect(results[activeIndex])
    } else {
      onCreateNew()
    }
    setOpen(false)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (selectedId) return
    if (e.key === 'ArrowDown') {
      if (!open) { setOpen(true); return }
      if (totalRows === 0) return
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % totalRows)
    } else if (e.key === 'ArrowUp') {
      if (!open || totalRows === 0) return
      e.preventDefault()
      setActiveIndex((i) => (i - 1 + totalRows) % totalRows)
    } else if (e.key === 'Enter') {
      if (open && totalRows > 0) {
        e.preventDefault()
        commitActive()
      }
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); setOpen(false) }
    } else if (e.key === 'Home') {
      if (open && totalRows > 0) { e.preventDefault(); setActiveIndex(0) }
    } else if (e.key === 'End') {
      if (open && totalRows > 0) { e.preventDefault(); setActiveIndex(totalRows - 1) }
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative flex items-center">
        <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          ref={inputRef ?? undefined}
          value={name}
          onChange={(e) => {
            if (selectedId) onClear()
            onChange(e.target.value)
            setActiveIndex(0)
            setOpen(true)
          }}
          onFocus={() => { if (!selectedId) setOpen(true) }}
          onKeyDown={handleKeyDown}
          placeholder="Search by name, email, or phone…"
          required
          className="pl-8 pr-8"
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls="client-selector-listbox"
          aria-activedescendant={
            open && activeIndex < results.length
              ? `client-opt-${results[activeIndex].id}`
              : undefined
          }
        />
        {selectedId ? (
          <button
            type="button"
            onClick={() => { onClear(); setOpen(true); inputRef?.current?.focus() }}
            className="absolute right-2 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Unlink client"
            title="Unlink client"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <ChevronDown
            className={`pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
          />
        )}
      </div>

      <p className={`mt-1 text-[11px] ${selectedId ? 'text-emerald-700' : 'text-muted-foreground'}`}>
        {selectedId
          ? '✓ Linked to existing client'
          : searching
          ? 'Searching…'
          : trimmed
          ? `${results.length} match${results.length === 1 ? '' : 'es'} — ↑↓ to navigate, ↵ to select`
          : `${clients.length} client${clients.length === 1 ? '' : 's'} on file — type to filter or pick one.`}
      </p>

      {open && !selectedId && (results.length > 0 || showCreate) && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-lg ring-1 ring-foreground/10">
          {results.length > 0 && (
            <ul
              ref={listRef}
              id="client-selector-listbox"
              className="max-h-64 overflow-y-auto py-1"
              role="listbox"
            >
              {results.map((c, idx) => {
                const active = idx === activeIndex
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      id={`client-opt-${c.id}`}
                      data-row-index={idx}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => { onSelect(c); setOpen(false) }}
                      className={`flex w-full items-start gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                        active ? 'bg-primary/10 text-foreground' : 'hover:bg-muted'
                      }`}
                      role="option"
                      aria-selected={active}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {c.name.charAt(0).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <p className="truncate font-medium leading-tight">
                          {highlightMatch(c.name, trimmed)}
                        </p>
                        <p className="truncate text-[11px] text-muted-foreground flex items-center gap-2">
                          {c.email && (
                            <span className="inline-flex items-center gap-1 truncate">
                              <Mail className="h-3 w-3 shrink-0" />
                              <span className="truncate">{highlightMatch(c.email, trimmed)}</span>
                            </span>
                          )}
                          {c.phone && (
                            <span className="inline-flex items-center gap-1 truncate">
                              <Phone className="h-3 w-3 shrink-0" />
                              <span className="truncate tabular-nums">{highlightMatch(c.phone, trimmed)}</span>
                            </span>
                          )}
                          {!c.email && !c.phone && <span>No contact info</span>}
                        </p>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {showCreate && (
            <button
              type="button"
              data-row-index={results.length}
              onMouseEnter={() => setActiveIndex(results.length)}
              onClick={() => { onCreateNew(); setOpen(false) }}
              className={`flex w-full items-center gap-2 border-t px-3 py-2 text-left text-xs font-semibold text-foreground transition-colors ${
                activeIndex === results.length ? 'bg-primary/10' : 'bg-muted/40 hover:bg-muted'
              }`}
            >
              <UserPlus className="h-3.5 w-3.5" />
              Create new client &quot;{trimmed}&quot;
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// Color-coded service picker. Renders a real <select name="service_id"> so it
// participates in form submission unchanged, but overlays a styled trigger
// that shows the selected service's color swatch. The native <select> sits
// invisibly on top so the OS popup still works for keyboard/touch users.
function ServiceSelect({
  services,
  defaultValue,
}: {
  services: Service[]
  defaultValue: string
}) {
  const [value, setValue] = useState<string>(defaultValue)
  const selected = services.find((s) => s.id === value) ?? null
  const swatch = selected ? getServiceHex(selected) : null

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="service_id">Service *</Label>
      <div className="relative">
        {/* Visual trigger: shows color swatch for the current value. */}
        <div
          className="pointer-events-none flex h-8 w-full items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 text-sm"
          aria-hidden="true"
        >
          {swatch && (
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-foreground/10"
              style={{ backgroundColor: swatch }}
            />
          )}
          <span className={`truncate ${selected ? '' : 'text-muted-foreground'}`}>
            {selected ? `${selected.name} (${selected.duration_minutes} min)` : 'Select service'}
          </span>
          <span className="ml-auto text-muted-foreground">▾</span>
        </div>
        <select
          id="service_id"
          name="service_id"
          required
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        >
          <option value="" disabled>Select service</option>
          {services.map((s) => {
            const hex = getServiceHex(s)
            return (
              <option
                key={s.id}
                value={s.id}
                style={{ backgroundColor: `${hex}22`, color: 'inherit' }}
              >
                ● {s.name} ({s.duration_minutes} min)
              </option>
            )
          })}
        </select>
      </div>
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
  clients,
  onSaved,
  onDelete,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  editing: AppointmentRow | null
  defaultStartsAt: string
  defaultStaffId: string | null
  services: Service[]
  staffList: Staff[]
  clients: ClientSummary[]
  onSaved: () => void
  onDelete?: (apt: AppointmentRow) => void
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
    editing ? toDatetimeLocal(snapToSlot(parseISO(editing.starts_at))) : defaultStartsAt,
  )
  const [duration, setDuration] = useState<number>(initialDuration)

  useEffect(() => {
    if (!open) return
    setFormError(null)
    setClientId(editing?.client_id ?? null)
    setClientName(editing?.client_name ?? '')
    setClientEmail(editing?.client_email ?? '')
    setClientPhone(editing?.client_phone ?? '')
    setStartsAt(editing ? toDatetimeLocal(snapToSlot(parseISO(editing.starts_at))) : defaultStartsAt)
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
    // Browser support for `step` on datetime-local is uneven, so snap defensively.
    const parsed = startsAt ? parseISO(startsAt) : null
    const snappedStart = parsed && !isNaN(parsed.getTime())
      ? toDatetimeLocal(snapToSlot(parsed))
      : startsAt
    fd.set('starts_at', snappedStart)
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
              clients={clients}
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

          {linked ? (
            // Polished CRM-style summary card for the resolved client. The
            // server reads client_id and ignores email/phone, but we keep the
            // values in state so unlinking restores them as editable inputs.
            <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50/50 px-3 py-2.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700">
                {(clientName.charAt(0) || '?').toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold leading-tight text-emerald-900">
                  {clientName || 'Linked client'}
                </p>
                <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-emerald-800/80">
                  {clientEmail && (
                    <span className="inline-flex items-center gap-1 truncate">
                      <Mail className="h-3 w-3 shrink-0" />
                      <span className="truncate">{clientEmail}</span>
                    </span>
                  )}
                  {clientPhone && (
                    <span className="inline-flex items-center gap-1 truncate">
                      <Phone className="h-3 w-3 shrink-0" />
                      <span className="truncate tabular-nums">{clientPhone}</span>
                    </span>
                  )}
                  {!clientEmail && !clientPhone && <span className="italic">No contact info on file</span>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setClientId(null)
                  // Don't wipe the contact fields — the user may have wanted to
                  // edit them; clearing the link reactivates the inputs below.
                  // Refocus the search input so they can pick a different client.
                  setTimeout(() => nameInputRef.current?.focus(), 0)
                }}
                className="shrink-0 rounded-md border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-medium text-emerald-800 hover:bg-emerald-50"
              >
                Change
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="client_email">Email</Label>
                <Input
                  ref={emailInputRef}
                  id="client_email"
                  type="email"
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  placeholder="sara@example.com"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="client_phone">Phone</Label>
                <Input
                  id="client_phone"
                  type="tel"
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                  placeholder="+212 6 00 00 00 00"
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <ServiceSelect
              services={services}
              defaultValue={editing?.service_id ?? ''}
            />
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
                step={SLOT_MIN * 60}
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                Slots run every {SLOT_MIN} minutes (00, 15, 30, 45).
              </p>
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

        <DialogFooter className="sm:justify-between">
          <div>
            {editing && onDelete && (
              <Button
                variant="destructive"
                type="button"
                disabled={isPending}
                onClick={() => onDelete(editing)}
              >
                Delete
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" type="button" disabled={isPending} onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" form="apt-form" disabled={isPending}>
              {isPending ? 'Saving…' : editing ? 'Save Changes' : 'Book Appointment'}
            </Button>
          </div>
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
  clients: ClientSummary[]
  filter: ActiveFilter
}

export function AppointmentsClient({ appointments, services, staffList, clients, filter }: Props) {
  const router = useRouter()
  const [view, setView] = useState<ViewMode>('schedule')
  const [currentDate, setCurrentDate] = useState(() => new Date())
  const [formOpen, setFormOpen] = useState(false)
  const [editingApt, setEditingApt] = useState<AppointmentRow | null>(null)
  const [defaultStartsAt, setDefaultStartsAt] = useState('')
  const [defaultStaffId, setDefaultStaffId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  // Stable color resolver: pre-computes from the active service list, then
  // falls back to a deterministic hash on the service id for any appointment
  // pointing at a service the list no longer contains (e.g. soft-deleted).
  // The fallback path is pure — no caching needed, since `getServiceColor`
  // hashes the same id to the same hex on every call.
  const colorFor = useMemo<(serviceId: string) => ServiceColor>(() => {
    const known = new Map<string, ServiceColor>()
    for (const s of services) known.set(s.id, getServiceColor(s))
    return (serviceId: string) => known.get(serviceId) ?? getServiceColor({ id: serviceId })
  }, [services])

  function navigate(dir: -1 | 1) {
    setCurrentDate((d) => {
      if (view === 'schedule') return dir === 1 ? addDays(d, 1) : subDays(d, 1)
      if (view === 'week')     return dir === 1 ? addWeeks(d, 1) : subWeeks(d, 1)
      return dir === 1 ? addMonths(d, 1) : subMonths(d, 1)
    })
  }

  function openCreate(opts?: { time?: Date; staffId?: string | null }) {
    setEditingApt(null)
    const seed = opts?.time ?? new Date()
    setDefaultStartsAt(toDatetimeLocal(snapToSlot(seed)))
    setDefaultStaffId(opts?.staffId ?? null)
    setFormOpen(true)
  }

  function openEdit(apt: AppointmentRow) {
    setEditingApt(apt)
    setDefaultStartsAt('')
    setDefaultStaffId(null)
    setFormOpen(true)
  }

  function handleDelete(apt: AppointmentRow) {
    if (!confirm(`Delete appointment for "${apt.client_name}"?`)) return
    setFormOpen(false)
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
            colorFor={colorFor}
            onClickApt={openEdit}
            onClickSlot={({ time, staffId }) => openCreate({ time, staffId })}
          />
        )}
        {view === 'week' && (
          <WeekView
            date={currentDate}
            appointments={appointments}
            colorFor={colorFor}
            onClickApt={openEdit}
            onClickSlot={(d) => openCreate({ time: d })}
          />
        )}
        {view === 'month' && (
          <MonthView
            date={currentDate}
            appointments={appointments}
            colorFor={colorFor}
            onClickApt={openEdit}
            onClickDay={(d) => { setCurrentDate(d); setView('schedule') }}
          />
        )}
      </div>

      <AptFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editingApt}
        defaultStartsAt={defaultStartsAt}
        defaultStaffId={defaultStaffId}
        services={services}
        staffList={staffList}
        clients={clients}
        onSaved={() => router.refresh()}
        onDelete={handleDelete}
      />
    </div>
  )
}
