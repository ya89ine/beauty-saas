'use client'

import { useState, useTransition, useMemo, useEffect, useRef } from 'react'
import { format, parseISO, differenceInCalendarDays, formatDistanceToNow } from 'date-fns'
import { setClinicStatus, saveClinicNotes, saveClinicBilling, createClinic, extendTrial } from './actions'
import { seedDemoData, clearDemoData } from './seed-actions'
import { toast } from 'sonner'

type SubscriptionStatus = 'trial' | 'active' | 'paused'

export type ClinicRow = {
  id: string
  name: string
  slug: string
  created_at: string
  ownerEmail: string
  subscription_status: SubscriptionStatus
  admin_notes: string | null
  booking_enabled: boolean
  monthly_price: number | null
  billing_notes: string | null
  trial_started_at: string | null
  trial_ends_at: string | null
  current_period_end: string | null
  last_active_at: string | null
  totalClients: number
  totalAppointments: number
  revenue: number
  hasServices: boolean
  hasStaff: boolean
  hasAppointments: boolean
  ghlConnected: boolean
}

export type RecentAppointment = {
  id: string
  created_at: string
  starts_at: string
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show'
  client_name: string
  clinic_name: string
  clinic_slug: string
  service_name: string | null
}

export type RecentRevenue = {
  id: string
  created_at: string
  client_name: string
  clinic_name: string
  amount: number
}

const STATUS_CFG: Record<SubscriptionStatus, { label: string; dot: string; text: string; bg: string; ring: string }> = {
  trial:  { label: 'Trial',  dot: 'bg-blue-400',   text: 'text-blue-700',   bg: 'bg-blue-50',   ring: 'ring-blue-200'   },
  active: { label: 'Active', dot: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50', ring: 'ring-emerald-200' },
  paused: { label: 'Paused', dot: 'bg-slate-400',   text: 'text-slate-600',  bg: 'bg-slate-100', ring: 'ring-slate-200'  },
}

function StatusIcon({ status, className = 'h-3 w-3' }: { status: SubscriptionStatus; className?: string }) {
  if (status === 'active') return <IconCheckCircle className={className} />
  if (status === 'trial') return <IconClock className={className} />
  return <IconPauseCircle className={className} />
}

// ── Operational predicates ────────────────────────────────────────────────────

const INACTIVE_THRESHOLD_DAYS = 14
const TRIAL_URGENT_DAYS = 3

type PaymentStatus = 'paid' | 'trial' | 'unpaid'

function paymentStatusOf(c: ClinicRow): PaymentStatus {
  if (c.subscription_status === 'active') return 'paid'
  if (c.subscription_status === 'trial') return 'trial'
  return 'unpaid'
}

function trialDaysLeft(c: ClinicRow, now: Date): number | null {
  if (c.subscription_status !== 'trial' || !c.trial_ends_at) return null
  return differenceInCalendarDays(parseISO(c.trial_ends_at), now)
}

function daysSinceActive(c: ClinicRow, now: Date): number | null {
  if (!c.last_active_at) return null
  return differenceInCalendarDays(now, parseISO(c.last_active_at))
}

function isTrialExpiring(c: ClinicRow, now: Date): boolean {
  const d = trialDaysLeft(c, now)
  return d !== null && d <= TRIAL_URGENT_DAYS
}

function isInactive(c: ClinicRow, now: Date): boolean {
  // Paused clinics are tracked separately; "inactive" focuses on operational silence
  if (c.subscription_status === 'paused') return false
  const d = daysSinceActive(c, now)
  return d === null || d >= INACTIVE_THRESHOLD_DAYS
}

function isUnpaid(c: ClinicRow): boolean {
  return c.subscription_status === 'paused'
}

const PAYMENT_CFG: Record<PaymentStatus, { label: string; cls: string }> = {
  paid:   { label: 'Paid',   cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  trial:  { label: 'Trial',  cls: 'bg-blue-50    text-blue-700    ring-blue-200'    },
  unpaid: { label: 'Unpaid', cls: 'bg-rose-50    text-rose-700    ring-rose-200'    },
}

function PaymentBadge({ status }: { status: PaymentStatus }) {
  const cfg = PAYMENT_CFG[status]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ${cfg.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${
        status === 'paid'   ? 'bg-emerald-500' :
        status === 'trial'  ? 'bg-blue-500' :
                              'bg-rose-500'
      }`} />
      {cfg.label}
    </span>
  )
}

function formatDH(n: number) {
  return `${n.toLocaleString('fr-MA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} DH`
}

function relativeTime(iso: string) {
  return formatDistanceToNow(parseISO(iso), { addSuffix: true })
}

// ── Inline icons ──────────────────────────────────────────────────────────────

function IconSearch() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
    </svg>
  )
}

function IconPencil() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}

function IconExternalLink() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  )
}

function IconPlus() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function IconEye() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function IconEyeOff() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
}

function IconCheck() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function IconX() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function IconBuilding() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <path d="M9 22v-4h6v4" />
      <path d="M8 6h.01M16 6h.01M8 10h.01M16 10h.01M8 14h.01M16 14h.01" />
    </svg>
  )
}

function IconCalendar() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}

function IconCoins() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="8" cy="8" r="6" />
      <path d="M18.09 10.37A6 6 0 1 1 10.34 18" />
      <path d="M7 6h1v4M16.71 13.88l.7.71-2.82 2.82" />
    </svg>
  )
}

function IconSparkles() {
  return (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
    </svg>
  )
}

function IconDots() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="19" cy="12" r="1.7" />
    </svg>
  )
}

function IconCopy() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

function IconAlert() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

function IconCard() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </svg>
  )
}

function IconNote() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="15" y2="17" />
    </svg>
  )
}

function IconClock({ className = 'h-3.5 w-3.5' }: { className?: string } = {}) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

function IconTrendUp() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </svg>
  )
}

function IconCheckCircle({ className = 'h-3 w-3' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  )
}

function IconPauseCircle({ className = 'h-3 w-3' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
      <circle cx="12" cy="12" r="10" />
      <line x1="10" y1="9" x2="10" y2="15" />
      <line x1="14" y1="9" x2="14" y2="15" />
    </svg>
  )
}

function IconArrowRight({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  )
}

function IconKey({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M21 2l-9.6 9.6" />
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="M21 2l-3 3M18 5l3 3M14.5 8.5l3 3" />
    </svg>
  )
}

function IconRocket({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </svg>
  )
}

function IconShieldCheck({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  )
}

function IconBolt({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M13 2L3 14h7l-1 8 11-13h-7z" />
    </svg>
  )
}

// ── Health indicator ──────────────────────────────────────────────────────────

function HealthDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-medium ${
        ok ? 'text-emerald-600' : 'text-slate-400'
      }`}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          ok ? 'bg-emerald-500' : 'bg-slate-300'
        }`}
      />
      {label}
    </span>
  )
}

// ── Status dropdown ───────────────────────────────────────────────────────────

function StatusDropdown({ clinic }: { clinic: ClinicRow }) {
  const [localStatus, setLocalStatus] = useState<SubscriptionStatus>(clinic.subscription_status)
  const [isPending, startTransition] = useTransition()
  const cfg = STATUS_CFG[localStatus]

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as SubscriptionStatus
    setLocalStatus(next)
    startTransition(async () => {
      const result = await setClinicStatus(clinic.id, next)
      if (result.error) {
        toast.error(result.error)
        setLocalStatus(clinic.subscription_status)
      } else {
        toast.success(`Status → ${STATUS_CFG[next].label}`)
      }
    })
  }

  return (
    <div className="relative inline-flex items-center">
      <span className={`pointer-events-none absolute left-2 ${cfg.text}`}>
        <StatusIcon status={localStatus} className="h-3 w-3" />
      </span>
      <select
        value={localStatus}
        onChange={onChange}
        disabled={isPending}
        className={`h-7 appearance-none rounded-full border pl-7 pr-3 text-xs font-semibold ring-1 transition-all cursor-pointer disabled:opacity-60 focus:outline-none focus:ring-2 hover:brightness-95 ${cfg.bg} ${cfg.text} ${cfg.ring}`}
      >
        <option value="trial">Trial</option>
        <option value="active">Active</option>
        <option value="paused">Paused</option>
      </select>
    </div>
  )
}

// ── Price cell (inline editable) ──────────────────────────────────────────────

function PriceCell({ clinic }: { clinic: ClinicRow }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(clinic.monthly_price !== null ? String(clinic.monthly_price) : '')
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  function commit() {
    const trimmed = value.trim()
    const parsed = trimmed === '' ? null : parseFloat(trimmed)
    if (parsed !== null && isNaN(parsed)) {
      toast.error('Price must be a number')
      setValue(clinic.monthly_price !== null ? String(clinic.monthly_price) : '')
      setEditing(false)
      return
    }
    if (parsed === clinic.monthly_price) {
      setEditing(false)
      return
    }
    startTransition(async () => {
      const result = await saveClinicBilling(clinic.id, parsed, clinic.billing_notes ?? '')
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success(`Price → ${parsed === null ? '—' : formatDH(parsed)}`)
        setEditing(false)
      }
    })
  }

  function cancel() {
    setValue(clinic.monthly_price !== null ? String(clinic.monthly_price) : '')
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1 min-w-[110px]">
        <input
          ref={inputRef}
          type="number"
          value={value}
          min={0}
          step={0.01}
          disabled={isPending}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit() }
            if (e.key === 'Escape') { e.preventDefault(); cancel() }
          }}
          className="h-7 w-20 rounded-md border border-input bg-background px-2 text-xs tabular-nums focus:outline-none focus:ring-2 focus:ring-ring/50"
          placeholder="0"
        />
        <span className="text-[10px] text-muted-foreground">DH/mo</span>
      </div>
    )
  }

  return (
    <button
      onClick={() => setEditing(true)}
      title="Click to edit monthly price"
      className="group min-w-[100px] rounded-md px-1 py-0.5 text-left hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring/50"
    >
      {clinic.monthly_price !== null ? (
        <p className="text-sm font-semibold tabular-nums leading-tight">
          {formatDH(clinic.monthly_price)}
          <span className="ml-0.5 text-[11px] font-normal text-muted-foreground">/mo</span>
        </p>
      ) : (
        <p className="text-xs italic text-muted-foreground/60 underline-offset-2 group-hover:underline">
          Set price
        </p>
      )}
      {clinic.billing_notes && (
        <p
          className="mt-0.5 max-w-[140px] truncate text-[11px] text-muted-foreground"
          title={clinic.billing_notes}
        >
          {clinic.billing_notes}
        </p>
      )}
    </button>
  )
}

// ── Edit billing modal ────────────────────────────────────────────────────────

function EditBillingModal({ clinic, onClose }: { clinic: ClinicRow; onClose: () => void }) {
  const [price, setPrice] = useState(clinic.monthly_price !== null ? String(clinic.monthly_price) : '')
  const [notes, setNotes] = useState(clinic.billing_notes ?? '')
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function save() {
    const parsed = price.trim() === '' ? null : parseFloat(price)
    if (parsed !== null && isNaN(parsed)) {
      toast.error('Price must be a number')
      return
    }
    startTransition(async () => {
      const result = await saveClinicBilling(clinic.id, parsed, notes)
      if (result.error) toast.error(result.error)
      else {
        toast.success('Billing saved')
        onClose()
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-2xl border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-base font-semibold">Edit billing</h2>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{clinic.name}</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
            <IconX />
          </button>
        </div>
        <div className="flex flex-col gap-4 px-6 py-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">Monthly price (DH)</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                min={0}
                step={0.01}
                placeholder="0"
                className="h-9 w-32 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
              />
              <span className="text-xs text-muted-foreground">DH / month</span>
            </div>
            <p className="text-[11px] text-muted-foreground">Leave empty to clear the price.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">Billing notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Discount, custom plan, payment terms…"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring/50 resize-none"
            />
          </div>
          <div className="flex items-center justify-end gap-2 border-t pt-4">
            <button onClick={onClose} disabled={isPending} className="rounded-lg px-4 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50">
              Cancel
            </button>
            <button onClick={save} disabled={isPending} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
              {isPending ? 'Saving…' : 'Save billing'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Edit notes modal ──────────────────────────────────────────────────────────

function EditNotesModal({ clinic, onClose }: { clinic: ClinicRow; onClose: () => void }) {
  const [value, setValue] = useState(clinic.admin_notes ?? '')
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function save() {
    startTransition(async () => {
      const result = await saveClinicNotes(clinic.id, value)
      if (result.error) toast.error(result.error)
      else {
        toast.success('Note saved')
        onClose()
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-2xl border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-base font-semibold">Internal note</h2>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{clinic.name}</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
            <IconX />
          </button>
        </div>
        <div className="flex flex-col gap-4 px-6 py-5">
          <textarea
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={6}
            placeholder="Anything you want to remember about this clinic…"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring/50 resize-none"
          />
          <p className="text-[11px] text-muted-foreground">Only visible to admins.</p>
          <div className="flex items-center justify-end gap-2 border-t pt-4">
            <button onClick={onClose} disabled={isPending} className="rounded-lg px-4 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50">
              Cancel
            </button>
            <button onClick={save} disabled={isPending} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
              {isPending ? 'Saving…' : 'Save note'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Notes summary cell ────────────────────────────────────────────────────────

function NotesPreview({ clinic }: { clinic: ClinicRow }) {
  if (!clinic.admin_notes) return null
  return (
    <p
      className="mt-0.5 max-w-[180px] truncate text-[11px] italic text-muted-foreground/80"
      title={clinic.admin_notes}
    >
      “{clinic.admin_notes}”
    </p>
  )
}

// ── Add clinic modal ──────────────────────────────────────────────────────────

function slugify(str: string) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

function InlineCreateClinic({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [ownerName, setOwnerName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [status, setStatus] = useState<SubscriptionStatus>('trial')
  const [formError, setFormError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleNameChange(v: string) {
    setName(v)
    if (!slugTouched) setSlug(slugify(v))
  }

  function handleSlugChange(v: string) {
    setSlugTouched(true)
    setSlug(v.toLowerCase().replace(/[^a-z0-9-]/g, ''))
  }

  function reset() {
    setName(''); setSlug(''); setSlugTouched(false)
    setOwnerName(''); setOwnerEmail(''); setPassword('')
    setStatus('trial'); setFormError(null)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    const fd = new FormData()
    fd.set('name', name)
    fd.set('slug', slug)
    fd.set('ownerEmail', ownerEmail)
    fd.set('ownerName', ownerName)
    fd.set('password', password)
    fd.set('status', status)
    startTransition(async () => {
      const result = await createClinic(fd)
      if (result.error) {
        setFormError(result.error)
      } else {
        toast.success(`Created "${name}"`)
        reset()
        // keep form open in case operator wants to add another
      }
    })
  }

  const inputCls = 'h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring/50'

  if (!open) return null

  return (
    <div className="rounded-md border bg-card">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          New clinic
        </p>
        <button
          onClick={() => onOpenChange(false)}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Close form"
          type="button"
        >
          <IconX />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="grid gap-2 p-3 md:grid-cols-6">
        {formError && (
          <div className="md:col-span-6 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
            {formError}
          </div>
        )}

        <div className="md:col-span-2">
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Clinic name *
          </label>
          <input
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            required
            placeholder="Beauty Studio Casablanca"
            className={`${inputCls} mt-0.5`}
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Slug *
          </label>
          <input
            value={slug}
            onChange={(e) => handleSlugChange(e.target.value)}
            required
            placeholder="beauty-studio-casablanca"
            className={`${inputCls} mt-0.5 font-mono`}
          />
          {slug && (
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              /book/<span className="font-mono">{slug}</span>
            </p>
          )}
        </div>
        <div className="md:col-span-1">
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Status
          </label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as SubscriptionStatus)}
            className={`${inputCls} mt-0.5 cursor-pointer`}
          >
            <option value="trial">Trial</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
          </select>
        </div>
        <div className="md:col-span-1 flex items-end">
          <button
            type="submit"
            disabled={isPending}
            className="h-8 w-full rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {isPending ? 'Creating…' : 'Create'}
          </button>
        </div>

        <div className="md:col-span-2">
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Owner full name *
          </label>
          <input
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            required
            placeholder="Fatima Zahra"
            className={`${inputCls} mt-0.5`}
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Owner email *
          </label>
          <input
            type="email"
            value={ownerEmail}
            onChange={(e) => setOwnerEmail(e.target.value)}
            required
            placeholder="owner@example.com"
            className={`${inputCls} mt-0.5`}
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Owner password *
          </label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              placeholder="≥ 8 characters"
              className={`${inputCls} mt-0.5 pr-8`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              tabIndex={-1}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPassword ? <IconEyeOff /> : <IconEye />}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

// ── Row actions menu ──────────────────────────────────────────────────────────

function RowActionsMenu({
  clinic,
  onEditBilling,
  onEditNotes,
  onSetStatus,
  onExtendTrial,
}: {
  clinic: ClinicRow
  onEditBilling: () => void
  onEditNotes: () => void
  onSetStatus: (status: SubscriptionStatus) => void
  onExtendTrial: (days: number) => void
}) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function copyId() {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(clinic.id).then(
        () => toast.success('Clinic ID copied'),
        () => toast.error('Failed to copy'),
      )
    }
    setOpen(false)
  }

  function close(fn: () => void) {
    setOpen(false)
    fn()
  }

  const itemCls =
    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground hover:bg-muted transition-colors disabled:opacity-50'

  return (
    <div ref={menuRef} className="relative inline-flex">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Open actions menu"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      >
        <IconDots />
      </button>

      {open && (
        <div className="absolute right-0 top-8 z-30 w-48 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10">
          {clinic.booking_enabled ? (
            <a
              href={`/book/${clinic.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className={itemCls}
              onClick={() => setOpen(false)}
            >
              <IconExternalLink />
              View booking page
            </a>
          ) : (
            <span
              className={`${itemCls} cursor-default opacity-50`}
              title="Booking page is disabled by the owner."
            >
              <IconExternalLink />
              Booking page off
            </span>
          )}

          <div className="my-1 h-px bg-border" />
          <p className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Subscription
          </p>
          <button
            onClick={() => close(() => onSetStatus('active'))}
            disabled={clinic.subscription_status === 'active'}
            className={itemCls}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Activate
          </button>
          <button
            onClick={() => close(() => onSetStatus('paused'))}
            disabled={clinic.subscription_status === 'paused'}
            className={itemCls}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
            Pause
          </button>
          <button
            onClick={() => close(() => onSetStatus('trial'))}
            disabled={clinic.subscription_status === 'trial'}
            className={itemCls}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
            Set to Trial
          </button>

          <div className="my-1 h-px bg-border" />
          <p className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Extend trial
          </p>
          <div className="flex gap-1 px-1 pb-1">
            <button
              onClick={() => close(() => onExtendTrial(7))}
              className="flex-1 rounded-md border bg-background px-2 py-1 text-[11px] font-semibold hover:bg-muted transition-colors"
            >
              +7d
            </button>
            <button
              onClick={() => close(() => onExtendTrial(14))}
              className="flex-1 rounded-md border bg-background px-2 py-1 text-[11px] font-semibold hover:bg-muted transition-colors"
            >
              +14d
            </button>
            <button
              onClick={() => close(() => onExtendTrial(30))}
              className="flex-1 rounded-md border bg-background px-2 py-1 text-[11px] font-semibold hover:bg-muted transition-colors"
            >
              +30d
            </button>
          </div>

          <div className="my-1 h-px bg-border" />
          <button onClick={() => close(onEditBilling)} className={itemCls}>
            <IconCard />
            Edit billing
          </button>
          <button onClick={() => close(onEditNotes)} className={itemCls}>
            <IconNote />
            Edit notes
          </button>

          <div className="my-1 h-px bg-border" />
          <button onClick={copyId} className={itemCls}>
            <IconCopy />
            Copy clinic ID
          </button>
        </div>
      )}
    </div>
  )
}

// ── Subscription cell ─────────────────────────────────────────────────────────

function SubscriptionCell({ clinic }: { clinic: ClinicRow }) {
  const today = new Date()

  if (clinic.subscription_status === 'trial' && clinic.trial_ends_at) {
    const ends = parseISO(clinic.trial_ends_at)
    const daysLeft = differenceInCalendarDays(ends, today)
    const tone =
      daysLeft < 0    ? 'text-rose-700 bg-rose-50 ring-rose-200'
      : daysLeft <= 3 ? 'text-amber-700 bg-amber-50 ring-amber-200'
      :                 'text-slate-600 bg-slate-50 ring-slate-200'
    const label =
      daysLeft < 0    ? `Expired ${-daysLeft}d ago`
      : daysLeft === 0 ? 'Ends today'
      :                 `Trial ends in ${daysLeft}d`
    return (
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${tone}`}>
        {label}
      </span>
    )
  }

  if (clinic.subscription_status === 'active' && clinic.current_period_end) {
    const ends = parseISO(clinic.current_period_end)
    const daysLeft = differenceInCalendarDays(ends, today)
    const tone =
      daysLeft < 0    ? 'text-rose-700 bg-rose-50 ring-rose-200'
      : daysLeft <= 7 ? 'text-amber-700 bg-amber-50 ring-amber-200'
      :                 'text-emerald-700 bg-emerald-50 ring-emerald-200'
    const label =
      daysLeft < 0    ? `Renew ${-daysLeft}d overdue`
      : `Renews in ${daysLeft}d`
    return (
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${tone}`}>
        {label}
      </span>
    )
  }

  return <span className="text-[11px] italic text-muted-foreground/50">—</span>
}

// ── Last-active cell ──────────────────────────────────────────────────────────

function LastActiveCell({ at }: { at: string | null }) {
  if (!at) {
    return <span className="text-[11px] italic text-muted-foreground/50">Never</span>
  }
  const days = differenceInCalendarDays(new Date(), parseISO(at))
  const tone =
    days <= 1   ? 'text-emerald-700'
    : days <= 7 ? 'text-foreground/80'
    : days <= 30? 'text-amber-700'
    :             'text-rose-700'
  const label =
    days <= 0   ? 'Active today'
    : days === 1 ? 'Active 1d ago'
    :             `Active ${days}d ago`
  return <span className={`text-xs font-medium ${tone}`}>{label}</span>
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  hint,
  accent,
  icon,
  delta,
}: {
  label: string
  value: string | number
  hint?: string
  accent?: string
  icon?: React.ReactNode
  delta?: string
}) {
  return (
    <div className={`group relative overflow-hidden rounded-2xl border bg-card p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-foreground/15 ${accent ?? ''}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </p>
        {icon && (
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground transition-colors group-hover:bg-muted">
            {icon}
          </span>
        )}
      </div>
      <p className="mt-3 text-3xl font-extrabold tabular-nums tracking-tight text-foreground">
        {value}
      </p>
      <div className="mt-2 flex items-center gap-2">
        {delta && (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
            <IconTrendUp />
            {delta}
          </span>
        )}
        {hint && <p className="text-[11px] text-muted-foreground/80">{hint}</p>}
      </div>
    </div>
  )
}

// ── Ops summary bar (sticky) ──────────────────────────────────────────────────

function OpsSummaryBar({
  mrr,
  totalClinics,
  payingCount,
  trialCount,
  inactiveCount,
  pausedCount,
  expiringCount,
  lastActivityAt,
}: {
  mrr: number
  totalClinics: number
  payingCount: number
  trialCount: number
  inactiveCount: number
  pausedCount: number
  expiringCount: number
  lastActivityAt: string | null
}) {
  const alertTotal = expiringCount + inactiveCount + pausedCount
  const lastActivityLabel = lastActivityAt
    ? `${formatDistanceToNow(parseISO(lastActivityAt), { addSuffix: true })} (${format(parseISO(lastActivityAt), 'dd MMM HH:mm')})`
    : '— never —'

  return (
    <div className="sticky top-[57px] z-[5] border-b border-border bg-background px-6 py-2 shadow-[0_1px_0_rgba(0,0,0,0.02)]">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-5 gap-y-1.5 text-xs">
        <span className="flex items-baseline gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">MRR</span>
          <span className="text-base font-bold tabular-nums">{formatDH(mrr)}</span>
        </span>
        <span className="h-4 w-px bg-border" />
        <span className="flex items-baseline gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Clinics</span>
          <span className="font-semibold tabular-nums">{totalClinics}</span>
        </span>
        <span className="flex items-baseline gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">Paying</span>
          <span className="font-semibold tabular-nums text-emerald-700">{payingCount}</span>
        </span>
        <span className="flex items-baseline gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-700">Trial</span>
          <span className="font-semibold tabular-nums text-blue-700">{trialCount}</span>
        </span>
        <span className="flex items-baseline gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">Inactive</span>
          <span className="font-semibold tabular-nums text-amber-700">{inactiveCount}</span>
        </span>
        <span className="flex items-baseline gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-700">Paused</span>
          <span className="font-semibold tabular-nums text-slate-700">{pausedCount}</span>
        </span>
        <span className="h-4 w-px bg-border" />
        <span className={`flex items-baseline gap-1.5 ${alertTotal > 0 ? 'text-rose-700' : 'text-muted-foreground'}`}>
          <span className="text-[10px] font-semibold uppercase tracking-wider">Alerts</span>
          <span className="font-bold tabular-nums">{alertTotal}</span>
        </span>
        <span className="ml-auto flex items-baseline gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Last activity</span>
          <span className={`tabular-nums ${lastActivityAt ? 'text-foreground' : 'text-muted-foreground italic'}`}>
            {lastActivityLabel}
          </span>
        </span>
      </div>
    </div>
  )
}

// ── Dense data cell (ops dashboard) ───────────────────────────────────────────

function DataCell({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-card px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-lg font-bold tabular-nums tracking-tight">{value}</p>
    </div>
  )
}

// ── Section heading ───────────────────────────────────────────────────────────

function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: string
  action?: React.ReactNode
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

// ── Admin top bar (shared) ────────────────────────────────────────────────────

function AdminHeader({
  adminEmail,
  subtitle,
  rightSlot,
}: {
  adminEmail: string
  subtitle?: string
  rightSlot?: React.ReactNode
}) {
  return (
    <header className="sticky top-0 z-10 border-b border-border/60 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-sm ring-1 ring-primary/20">
            <span className="text-sm font-bold">A</span>
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold tracking-tight">GlowBook Admin</p>
            {subtitle && (
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {rightSlot}
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/80 px-3 py-1 text-xs font-medium text-foreground/80 ring-1 ring-border">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 ring-2 ring-emerald-500/20" />
            {adminEmail}
          </span>
        </div>
      </div>
    </header>
  )
}

// ── Alerts row ────────────────────────────────────────────────────────────────

type AlertFilter = 'expiring' | 'inactive' | 'unpaid' | 'no-bookings' | 'unconverted'

const TRIAL_UNCONVERTED_DAYS = 7

function isUnconvertedTrial(c: ClinicRow, now: Date): boolean {
  if (c.subscription_status !== 'trial') return false
  return differenceInCalendarDays(now, parseISO(c.created_at)) >= TRIAL_UNCONVERTED_DAYS
}

function hasNoBookings(c: ClinicRow): boolean {
  return c.totalAppointments === 0
}

function AlertCard({
  tone,
  count,
  label,
  hint,
  active,
  onClick,
  example,
}: {
  tone: 'rose' | 'amber' | 'slate'
  count: number
  label: string
  hint: string
  active: boolean
  onClick: () => void
  example?: string | null
}) {
  const cfg =
    tone === 'rose'
      ? { border: 'border-l-rose-500',  text: 'text-rose-700',   bgActive: 'bg-rose-50' }
      : tone === 'amber'
      ? { border: 'border-l-amber-500', text: 'text-amber-700',  bgActive: 'bg-amber-50' }
      : { border: 'border-l-slate-500', text: 'text-slate-700',  bgActive: 'bg-slate-100' }

  const isOff = count === 0

  return (
    <button
      onClick={onClick}
      disabled={isOff}
      aria-pressed={active}
      className={`flex w-full items-stretch gap-3 rounded-md border border-l-4 ${cfg.border} bg-card p-3 text-left transition-colors
        ${isOff ? 'opacity-50 cursor-default' : 'hover:bg-muted/40 cursor-pointer'}
        ${active ? cfg.bgActive : ''}
      `}
    >
      <div className="flex flex-col items-center justify-center px-1">
        <p className={`text-2xl font-bold tabular-nums leading-none ${isOff ? 'text-muted-foreground/50' : cfg.text}`}>
          {count}
        </p>
      </div>
      <div className="min-w-0 flex-1 border-l pl-3">
        <p className={`text-xs font-semibold ${isOff ? 'text-muted-foreground' : 'text-foreground'}`}>
          {label}
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
        {example && !isOff && (
          <p className="mt-0.5 truncate text-[11px] text-foreground/60" title={example}>
            e.g. {example}
          </p>
        )}
        {!isOff && (
          <p className={`mt-1 text-[10px] font-semibold uppercase tracking-wider ${active ? cfg.text : 'text-muted-foreground'}`}>
            {active ? '✓ Filtering' : 'Click to filter'}
          </p>
        )}
      </div>
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

type EditModal = { type: 'billing' | 'notes'; clinic: ClinicRow } | null
type SortKey = 'newest' | 'revenue' | 'inactive' | 'trial-ending'

export function AdminClient({
  clinics,
  adminEmail,
  mrr,
  appointmentsToday,
  revenueToday,
  appointmentsThisMonth,
  revenueThisMonth,
  newClinicsThisMonth,
  isDev,
}: {
  clinics: ClinicRow[]
  adminEmail: string
  mrr: number
  appointmentsToday: number
  revenueToday: number
  appointmentsThisMonth: number
  revenueThisMonth: number
  newClinicsThisMonth: number
  isDev: boolean
}) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<SubscriptionStatus | 'all'>('all')
  const [alertFilter, setAlertFilter] = useState<AlertFilter | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('newest')
  const [showAddModal, setShowAddModal] = useState(false)
  const [editModal, setEditModal] = useState<EditModal>(null)
  const [, startStatusTransition] = useTransition()
  const [, startExtendTransition] = useTransition()
  const [seedPending, startSeedTransition] = useTransition()

  function runSeed() {
    if (!isDev) return
    startSeedTransition(async () => {
      const result = await seedDemoData()
      if (result.error) toast.error(result.error)
      else toast.success(result.message ?? 'Demo data seeded')
    })
  }

  function runClear() {
    if (!isDev) return
    if (typeof window !== 'undefined' && !window.confirm('Delete all demo clinics and their owner accounts? This cannot be undone.')) return
    startSeedTransition(async () => {
      const result = await clearDemoData()
      if (result.error) toast.error(result.error)
      else toast.success(result.message ?? 'Demo data cleared')
    })
  }

  const hasDemoData = clinics.some((c) => c.slug.startsWith('demo-'))

  const now = useMemo(() => new Date(), [])

  function quickSetStatus(clinic: ClinicRow, next: SubscriptionStatus) {
    if (clinic.subscription_status === next) return
    startStatusTransition(async () => {
      const result = await setClinicStatus(clinic.id, next)
      if (result.error) toast.error(result.error)
      else toast.success(`${clinic.name} → ${STATUS_CFG[next].label}`)
    })
  }

  function quickExtendTrial(clinic: ClinicRow, days: number) {
    startExtendTransition(async () => {
      const result = await extendTrial(clinic.id, days)
      if (result.error) toast.error(result.error)
      else toast.success(`${clinic.name} trial extended +${days}d`)
    })
  }

  const totalRevenue = useMemo(() => clinics.reduce((sum, c) => sum + c.revenue, 0), [clinics])
  const activeCount  = useMemo(() => clinics.filter((c) => c.subscription_status === 'active').length, [clinics])
  const trialCount   = useMemo(() => clinics.filter((c) => c.subscription_status === 'trial').length, [clinics])
  const latestClinic = clinics[0] ?? null

  // Alert lists (precomputed once per render)
  const expiringClinics    = useMemo(() => clinics.filter((c) => isTrialExpiring(c, now)),    [clinics, now])
  const inactiveClinics    = useMemo(() => clinics.filter((c) => isInactive(c, now)),         [clinics, now])
  const unpaidClinics      = useMemo(() => clinics.filter((c) => isUnpaid(c)),                [clinics])
  const noBookingsClinics  = useMemo(() => clinics.filter((c) => hasNoBookings(c)),           [clinics])
  const unconvertedClinics = useMemo(() => clinics.filter((c) => isUnconvertedTrial(c, now)), [clinics, now])

  const lastGlobalActivity = useMemo(() => {
    let max: string | null = null
    for (const c of clinics) {
      if (!c.last_active_at) continue
      if (!max || c.last_active_at > max) max = c.last_active_at
    }
    return max
  }, [clinics])

  const payingCount = activeCount

  function toggleAlert(kind: AlertFilter) {
    setAlertFilter((cur) => (cur === kind ? null : kind))
    if (alertFilter !== kind) setStatusFilter('all')
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = clinics.filter((c) => {
      const matchSearch = !q || c.name.toLowerCase().includes(q) || c.slug.toLowerCase().includes(q) || c.ownerEmail.toLowerCase().includes(q)
      if (!matchSearch) return false
      if (alertFilter === 'expiring')    return isTrialExpiring(c, now)
      if (alertFilter === 'inactive')    return isInactive(c, now)
      if (alertFilter === 'unpaid')      return isUnpaid(c)
      if (alertFilter === 'no-bookings') return hasNoBookings(c)
      if (alertFilter === 'unconverted') return isUnconvertedTrial(c, now)
      return statusFilter === 'all' || c.subscription_status === statusFilter
    })

    // Sort
    return [...list].sort((a, b) => {
      switch (sortKey) {
        case 'revenue':
          return b.revenue - a.revenue
        case 'inactive': {
          // Never-active first (treat null as +Infinity), then most days inactive
          const da = a.last_active_at ? parseISO(a.last_active_at).getTime() : -Infinity
          const db = b.last_active_at ? parseISO(b.last_active_at).getTime() : -Infinity
          return da - db
        }
        case 'trial-ending': {
          // Trials with earliest end first, then everyone else
          const aEnd = a.subscription_status === 'trial' && a.trial_ends_at ? parseISO(a.trial_ends_at).getTime() : Infinity
          const bEnd = b.subscription_status === 'trial' && b.trial_ends_at ? parseISO(b.trial_ends_at).getTime() : Infinity
          return aEnd - bEnd
        }
        case 'newest':
        default:
          return parseISO(b.created_at).getTime() - parseISO(a.created_at).getTime()
      }
    })
  }, [clinics, search, statusFilter, alertFilter, sortKey, now])

  const pausedCount = clinics.filter((c) => c.subscription_status === 'paused').length
  const isEmpty = clinics.length === 0

  return (
    <div className="min-h-screen bg-muted/30">

      {editModal?.type === 'billing' && (
        <EditBillingModal clinic={editModal.clinic} onClose={() => setEditModal(null)} />
      )}
      {editModal?.type === 'notes' && (
        <EditNotesModal clinic={editModal.clinic} onClose={() => setEditModal(null)} />
      )}

      <AdminHeader adminEmail={adminEmail} subtitle="Operations" />

      <OpsSummaryBar
        mrr={mrr}
        totalClinics={clinics.length}
        payingCount={payingCount}
        trialCount={trialCount}
        inactiveCount={inactiveClinics.length}
        pausedCount={pausedCount}
        expiringCount={expiringClinics.length}
        lastActivityAt={lastGlobalActivity}
      />

      <main className="mx-auto max-w-7xl px-6 py-5 space-y-5">

        {/* ── Page heading ──────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
          <div>
            <h1 className="text-base font-bold tracking-tight">
              Admin · Operations
              {isDev && (
                <span className="ml-2 inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-800 ring-1 ring-amber-200">
                  Dev
                </span>
              )}
            </h1>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {clinics.length} {clinics.length === 1 ? 'clinic' : 'clinics'} · refreshed {format(now, 'dd MMM HH:mm')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isDev && (
              <>
                <button
                  onClick={runSeed}
                  disabled={seedPending}
                  title="Insert 3 demo clinics with staff, services, clients, and appointments"
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50 transition-colors"
                >
                  {seedPending ? 'Working…' : 'Seed demo data'}
                </button>
                {hasDemoData && (
                  <button
                    onClick={runClear}
                    disabled={seedPending}
                    title="Delete all demo clinics and their owner accounts"
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-rose-300 bg-rose-50 px-3 text-xs font-semibold text-rose-800 hover:bg-rose-100 disabled:opacity-50 transition-colors"
                  >
                    Clear demo
                  </button>
                )}
                <span className="h-6 w-px bg-border" aria-hidden="true" />
              </>
            )}
            <button
              onClick={() => setShowAddModal((v) => !v)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <IconPlus />
              {showAddModal ? 'Close form' : 'New clinic'}
            </button>
          </div>
        </div>

        {/* ── Alerts ────────────────────────────────────────────────────── */}
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Alerts <span className="font-normal text-muted-foreground/70">— click to filter the table</span>
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <AlertCard
              tone="rose"
              count={expiringClinics.length}
              label={`Trial ≤${TRIAL_URGENT_DAYS}d`}
              hint="Convert or extend"
              active={alertFilter === 'expiring'}
              onClick={() => toggleAlert('expiring')}
              example={expiringClinics[0]?.name ?? null}
            />
            <AlertCard
              tone="amber"
              count={unconvertedClinics.length}
              label={`Trial ≥${TRIAL_UNCONVERTED_DAYS}d`}
              hint="Not converted to paying"
              active={alertFilter === 'unconverted'}
              onClick={() => toggleAlert('unconverted')}
              example={unconvertedClinics[0]?.name ?? null}
            />
            <AlertCard
              tone="amber"
              count={noBookingsClinics.length}
              label="No bookings ever"
              hint="Onboarding stalled"
              active={alertFilter === 'no-bookings'}
              onClick={() => toggleAlert('no-bookings')}
              example={noBookingsClinics[0]?.name ?? null}
            />
            <AlertCard
              tone="amber"
              count={inactiveClinics.length}
              label={`Inactive ${INACTIVE_THRESHOLD_DAYS}d+`}
              hint="Was active, went silent"
              active={alertFilter === 'inactive'}
              onClick={() => toggleAlert('inactive')}
              example={inactiveClinics[0]?.name ?? null}
            />
            <AlertCard
              tone="slate"
              count={unpaidClinics.length}
              label="Unpaid (paused)"
              hint="Subscription paused"
              active={alertFilter === 'unpaid'}
              onClick={() => toggleAlert('unpaid')}
              example={unpaidClinics[0]?.name ?? null}
            />
          </div>
        </section>

        {/* ── Activity snapshot ─────────────────────────────────────────── */}
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Activity · Today / {format(now, 'MMM yyyy')}
          </h2>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-border md:grid-cols-3 lg:grid-cols-6">
            <DataCell label="Appts today"      value={appointmentsToday} />
            <DataCell label="Revenue today"    value={formatDH(revenueToday)} />
            <DataCell label="Appts this mo."   value={appointmentsThisMonth} />
            <DataCell label="Revenue this mo." value={formatDH(revenueThisMonth)} />
            <DataCell label="GMV all-time"     value={formatDH(totalRevenue)} />
            <DataCell label="New clinics mo."  value={newClinicsThisMonth} />
          </div>
        </section>

        {/* ── Inline create clinic ──────────────────────────────────────── */}
        <InlineCreateClinic open={showAddModal || isEmpty} onOpenChange={setShowAddModal} />

        {/* ── Section: Clinics directory ────────────────────────────────── */}
        <section>
          <SectionHeader
            title="Clinics"
            subtitle="Sortable directory with payment status, alerts, and quick actions"
          />

          <div className="rounded-md border bg-card overflow-hidden">

            {/* Toolbar */}
            <div className="border-b bg-muted/30 px-3 py-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                {alertFilter ? (
                  <span className="font-semibold text-foreground">
                    {filtered.length} flagged · {
                      alertFilter === 'expiring' ? `trials ending in ≤${TRIAL_URGENT_DAYS}d` :
                      alertFilter === 'inactive' ? `inactive ${INACTIVE_THRESHOLD_DAYS}d+` :
                      alertFilter === 'unpaid' ? 'paused / unpaid' :
                      alertFilter === 'no-bookings' ? 'no bookings ever' :
                      alertFilter === 'unconverted' ? `trial ≥${TRIAL_UNCONVERTED_DAYS}d (not converted)` :
                      ''
                    }
                  </span>
                ) : filtered.length === clinics.length ? (
                  `${clinics.length} registered`
                ) : (
                  `${filtered.length} of ${clinics.length}`
                )}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex items-center">
                  <span className="pointer-events-none absolute left-2.5 text-muted-foreground">
                    <IconSearch />
                  </span>
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search name, slug, or owner email…"
                    className="h-8 w-64 rounded-lg border border-input bg-background pl-8 pr-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring/50"
                  />
                </div>
                <select
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value as SubscriptionStatus | 'all')
                    setAlertFilter(null)
                  }}
                  disabled={alertFilter !== null}
                  className="h-8 rounded-lg border border-input bg-background px-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring/50 cursor-pointer disabled:opacity-50"
                  title={alertFilter ? 'Disabled while an alert filter is active' : undefined}
                >
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="trial">Trial</option>
                  <option value="paused">Paused</option>
                </select>
                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as SortKey)}
                  className="h-8 rounded-lg border border-input bg-background px-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring/50 cursor-pointer"
                  title="Sort"
                >
                  <option value="newest">Sort: Newest</option>
                  <option value="revenue">Sort: Most revenue</option>
                  <option value="inactive">Sort: Most inactive</option>
                  <option value="trial-ending">Sort: Trial ending soonest</option>
                </select>
                {alertFilter && (
                  <button
                    onClick={() => setAlertFilter(null)}
                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition-colors"
                  >
                    Clear alert
                    <IconX />
                  </button>
                )}
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2 text-left">Clinic</th>
                    <th className="px-3 py-2 text-left">Owner</th>
                    <th className="px-3 py-2 text-left">Payment</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Monthly</th>
                    <th className="px-3 py-2 text-left">Renewal</th>
                    <th className="px-3 py-2 text-left">Last active</th>
                    <th className="px-3 py-2 text-left">Setup</th>
                    <th className="px-3 py-2 text-right">Clients</th>
                    <th className="px-3 py-2 text-right">Appts</th>
                    <th className="px-3 py-2 text-right">GMV</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={12} className="py-12 text-center text-xs text-muted-foreground">
                        {clinics.length === 0
                          ? 'No clinics yet — create the first one using the form above.'
                          : 'No clinics match the current filters.'}
                      </td>
                    </tr>
                  )}
                  {filtered.map((clinic) => {
                    const expiring = isTrialExpiring(clinic, now)
                    const inactive = isInactive(clinic, now)
                    const unpaid = isUnpaid(clinic)
                    const rowTone =
                      expiring ? 'border-l-4 border-l-rose-400 bg-rose-50/30 hover:bg-rose-50/60'
                      : unpaid ? 'border-l-4 border-l-slate-400 bg-slate-100/40 hover:bg-slate-100/70'
                      : inactive ? 'border-l-4 border-l-amber-400 bg-amber-50/30 hover:bg-amber-50/60'
                      : 'hover:bg-muted/20'
                    return (
                    <tr key={clinic.id} className={`transition-colors ${rowTone}`}>
                      <td className="px-3 py-2 align-top">
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary font-semibold text-sm uppercase">
                            {clinic.name.charAt(0)}
                          </span>
                          <div className="min-w-0">
                            <p className="font-semibold leading-tight truncate">{clinic.name}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground truncate">
                              <span className="font-mono">/{clinic.slug}</span>
                              <span className="mx-1.5 opacity-30">·</span>
                              joined {format(parseISO(clinic.created_at), 'dd MMM yyyy')}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-1">
                              {expiring && (
                                <span className="inline-flex items-center gap-1 rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-800">
                                  <IconAlert />
                                  Trial ending
                                </span>
                              )}
                              {!expiring && unpaid && (
                                <span className="inline-flex items-center gap-1 rounded-md bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-700">
                                  <IconPauseCircle />
                                  Unpaid
                                </span>
                              )}
                              {!expiring && !unpaid && inactive && (
                                <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-800">
                                  <IconClock />
                                  Inactive
                                </span>
                              )}
                            </div>
                            <NotesPreview clinic={clinic} />
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top max-w-[200px]">
                        <p className="truncate text-xs text-foreground/80">{clinic.ownerEmail}</p>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <PaymentBadge status={paymentStatusOf(clinic)} />
                      </td>
                      <td className="px-3 py-2 align-top">
                        <StatusDropdown clinic={clinic} />
                      </td>
                      <td className="px-3 py-2 align-top">
                        <PriceCell clinic={clinic} />
                      </td>
                      <td className="px-3 py-2 align-top">
                        <SubscriptionCell clinic={clinic} />
                      </td>
                      <td className="px-3 py-2 align-top">
                        <LastActiveCell at={clinic.last_active_at} />
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                          <HealthDot ok={clinic.hasServices}     label="Services"     />
                          <HealthDot ok={clinic.hasStaff}        label="Staff"        />
                          <HealthDot ok={clinic.hasAppointments} label="Appts" />
                          <HealthDot ok={clinic.ghlConnected}    label="GHL"          />
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top text-right tabular-nums text-sm font-medium">
                        {clinic.totalClients.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 align-top text-right tabular-nums text-sm font-medium">
                        {clinic.totalAppointments.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 align-top text-right tabular-nums text-sm font-semibold">
                        {formatDH(clinic.revenue)}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="flex items-center justify-end gap-1">
                          {clinic.subscription_status !== 'active' && (
                            <button
                              onClick={() => quickSetStatus(clinic, 'active')}
                              title="Activate (mark as paying)"
                              className="inline-flex h-7 items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100 transition-colors"
                            >
                              <IconCheckCircle />
                              Activate
                            </button>
                          )}
                          {clinic.subscription_status === 'active' && (
                            <button
                              onClick={() => quickSetStatus(clinic, 'paused')}
                              title="Pause subscription"
                              className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-300 bg-slate-50 px-2 text-[11px] font-bold text-slate-700 hover:bg-slate-100 transition-colors"
                            >
                              <IconPauseCircle />
                              Pause
                            </button>
                          )}
                          {clinic.subscription_status === 'trial' && (
                            <button
                              onClick={() => quickExtendTrial(clinic, 7)}
                              title="Extend trial by 7 days"
                              className="inline-flex h-7 items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 text-[11px] font-bold text-blue-700 hover:bg-blue-100 transition-colors"
                            >
                              +7d
                            </button>
                          )}
                          {clinic.booking_enabled ? (
                            <a
                              href={`/book/${clinic.slug}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Open booking page"
                              className="inline-flex h-7 items-center gap-1 rounded-md border border-input bg-background px-2 text-[11px] font-semibold text-foreground hover:bg-muted transition-colors"
                            >
                              <IconExternalLink />
                              Open
                            </a>
                          ) : (
                            <span
                              title="Booking disabled by owner"
                              className="inline-flex h-7 items-center gap-1 rounded-md border border-dashed border-muted-foreground/30 px-2 text-[11px] text-muted-foreground/60"
                            >
                              <IconExternalLink />
                              Off
                            </span>
                          )}
                          <RowActionsMenu
                            clinic={clinic}
                            onEditBilling={() => setEditModal({ type: 'billing', clinic })}
                            onEditNotes={() => setEditModal({ type: 'notes', clinic })}
                            onSetStatus={(status) => quickSetStatus(clinic, status)}
                            onExtendTrial={(days) => quickExtendTrial(clinic, days)}
                          />
                        </div>
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>

      </main>
    </div>
  )
}

// Suppress unused warnings for icons reserved for future use
void IconSparkles
void IconTrendUp
