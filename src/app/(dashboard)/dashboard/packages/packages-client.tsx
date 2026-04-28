'use client'

import { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { format, parseISO } from 'date-fns'
import {
  Plus,
  Package,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
import {
  createPackage,
  updatePackage,
  cancelPackage,
  addPackagePayment,
  manualIncrementSession,
} from './actions'

// ─── Types ────────────────────────────────────────────────────────────────────

type Pkg = {
  id: string
  package_name: string
  total_price: number
  paid_amount: number
  total_sessions: number
  completed_sessions: number
  status: 'active' | 'completed' | 'cancelled'
  notes: string | null
  client_id: string
  service_id: string | null
  created_at: string
  client: { id: string; name: string; phone: string | null } | null
  service: { name: string } | null
}

type Payment = {
  id: string
  package_id: string
  amount: number
  paid_at: string
  payment_method: string
  notes: string | null
}

type ClientRow = { id: string; name: string; phone: string | null }
type ServiceRow = { id: string; name: string }

interface Props {
  packages: Pkg[]
  clients: ClientRow[]
  services: ServiceRow[]
  payments: Payment[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDH(n: number) {
  return `${n.toLocaleString('fr-MA', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} DH`
}

const STATUS_CFG = {
  active: {
    label: 'Active',
    variant: 'default' as const,
    Icon: Clock,
    color: 'text-emerald-600',
  },
  completed: {
    label: 'Completed',
    variant: 'secondary' as const,
    Icon: CheckCircle2,
    color: 'text-blue-600',
  },
  cancelled: {
    label: 'Cancelled',
    variant: 'destructive' as const,
    Icon: XCircle,
    color: 'text-slate-500',
  },
}

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  transfer: 'Transfer',
  cheque: 'Cheque',
}

// ─── Session progress bar ─────────────────────────────────────────────────────

function SessionBar({
  completed,
  total,
}: {
  completed: number
  total: number
}) {
  const pct = total > 0 ? Math.min((completed / total) * 100, 100) : 0
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-muted">
        <div
          className="h-1.5 rounded-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">
        {completed}/{total}
      </span>
    </div>
  )
}

// ─── Package detail dialog ────────────────────────────────────────────────────

function PackageDetailDialog({
  pkg,
  payments,
  onClose,
  onEdit,
}: {
  pkg: Pkg
  payments: Payment[]
  onClose: () => void
  onEdit: () => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showPayForm, setShowPayForm] = useState(false)
  const [payError, setPayError] = useState<string | null>(null)

  const pkgPayments = payments.filter((p) => p.package_id === pkg.id)
  const remaining = pkg.total_price - pkg.paid_amount
  const remainingSessions = pkg.total_sessions - pkg.completed_sessions

  function handleAddPayment(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPayError(null)
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await addPackagePayment(pkg.id, fd)
      if (result.error) {
        setPayError(result.error)
        return
      }
      toast.success('Payment recorded')
      setShowPayForm(false)
      router.refresh()
    })
  }

  function handleIncrementSession() {
    startTransition(async () => {
      const result = await manualIncrementSession(pkg.id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Session marked as completed')
      router.refresh()
    })
  }

  function handleCancel() {
    if (!confirm(`Cancel "${pkg.package_name}"? This cannot be undone.`)) return
    startTransition(async () => {
      const result = await cancelPackage(pkg.id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Package cancelled')
      onClose()
      router.refresh()
    })
  }

  const cfg = STATUS_CFG[pkg.status]

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" />
            {pkg.package_name}
            <Badge variant={cfg.variant} className="ml-auto text-xs">
              {cfg.label}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          {/* Client & service */}
          <div className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {pkg.client?.name ?? '—'}
            </span>
            {pkg.service && (
              <span> · {pkg.service.name}</span>
            )}
            {pkg.notes && (
              <p className="mt-1 text-xs">{pkg.notes}</p>
            )}
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Sessions</p>
              <p className="mt-1 text-xl font-bold">
                {remainingSessions}{' '}
                <span className="text-sm font-normal text-muted-foreground">
                  remaining
                </span>
              </p>
              <SessionBar
                completed={pkg.completed_sessions}
                total={pkg.total_sessions}
              />
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Balance</p>
              <p
                className={`mt-1 text-xl font-bold ${remaining > 0 ? 'text-amber-600' : 'text-emerald-600'}`}
              >
                {formatDH(remaining)}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDH(pkg.paid_amount)} paid of {formatDH(pkg.total_price)}
              </p>
            </div>
          </div>

          {/* Actions */}
          {pkg.status === 'active' && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={isPending || remainingSessions <= 0}
                onClick={handleIncrementSession}
              >
                <CheckCircle2 className="h-4 w-4" />
                Mark Session Done
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setShowPayForm(true); setPayError(null) }}
                disabled={isPending}
              >
                <Plus className="h-4 w-4" />
                Add Payment
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground"
                onClick={onEdit}
                disabled={isPending}
              >
                Edit Package
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                onClick={handleCancel}
                disabled={isPending}
              >
                Cancel Package
              </Button>
            </div>
          )}

          {/* Add payment form */}
          {showPayForm && (
            <form
              onSubmit={handleAddPayment}
              className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4"
            >
              <p className="text-sm font-medium">Record Payment</p>
              {payError && (
                <div className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {payError}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">Amount (DH) *</Label>
                  <Input
                    name="amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    placeholder="500"
                    className="h-8 text-sm"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">Date</Label>
                  <Input
                    name="paid_at"
                    type="date"
                    defaultValue={new Date().toISOString().slice(0, 10)}
                    className="h-8 text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">Method</Label>
                  <select
                    name="payment_method"
                    className="h-8 rounded-md border px-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="cash">Cash</option>
                    <option value="card">Card</option>
                    <option value="transfer">Transfer</option>
                    <option value="cheque">Cheque</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">Notes</Label>
                  <Input
                    name="notes"
                    placeholder="Optional"
                    className="h-8 text-sm"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={isPending}>
                  {isPending ? 'Saving…' : 'Save Payment'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowPayForm(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}

          {/* Payments history */}
          <div>
            <p className="mb-2 text-sm font-medium">
              Payment History
              {pkgPayments.length > 0 && (
                <span className="ml-2 text-xs text-muted-foreground">
                  ({pkgPayments.length})
                </span>
              )}
            </p>
            {pkgPayments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payments yet.</p>
            ) : (
              <div className="divide-y rounded-lg border text-sm">
                {pkgPayments.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between px-3 py-2"
                  >
                    <div>
                      <span className="font-medium">{formatDH(p.amount)}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {METHOD_LABELS[p.payment_method] ?? p.payment_method}
                      </span>
                      {p.notes && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          · {p.notes}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {format(parseISO(p.paid_at), 'dd MMM yyyy')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Create / Edit package dialog ─────────────────────────────────────────────

function PackageFormDialog({
  open,
  onOpenChange,
  editing,
  clients,
  services,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  editing: Pkg | null
  clients: ClientRow[]
  services: ServiceRow[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [formError, setFormError] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setFormError(null)
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = editing
        ? await updatePackage(editing.id, fd)
        : await createPackage(fd)
      if (result.error) {
        setFormError(result.error)
        return
      }
      onOpenChange(false)
      toast.success(editing ? 'Package updated' : 'Package created')
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!isPending) onOpenChange(v) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing ? 'Edit Package' : 'New Treatment Package'}
          </DialogTitle>
        </DialogHeader>

        <form
          key={editing?.id ?? 'new'}
          id="pkg-form"
          onSubmit={handleSubmit}
          className="flex flex-col gap-4"
        >
          {formError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {formError}
            </div>
          )}

          {!editing && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="client_id">Client *</Label>
              <select
                id="client_id"
                name="client_id"
                required
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring cursor-pointer"
              >
                <option value="">Select client</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.phone ? ` · ${c.phone}` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="package_name">Package name *</Label>
            <Input
              id="package_name"
              name="package_name"
              required
              defaultValue={editing?.package_name}
              placeholder="Laser Full Legs — 8 sessions"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="service_id">Service (optional)</Label>
            <select
              id="service_id"
              name="service_id"
              defaultValue={editing?.service_id ?? ''}
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring cursor-pointer"
            >
              <option value="">No specific service</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="total_price">Total price (DH) *</Label>
              <Input
                id="total_price"
                name="total_price"
                type="number"
                step="0.01"
                min="0"
                required
                defaultValue={editing?.total_price ?? ''}
                placeholder="3000"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="total_sessions">Total sessions *</Label>
              <Input
                id="total_sessions"
                name="total_sessions"
                type="number"
                min="1"
                required
                defaultValue={editing?.total_sessions ?? ''}
                placeholder="8"
              />
            </div>
          </div>

          {!editing && (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="initial_payment">Initial payment (DH)</Label>
                <Input
                  id="initial_payment"
                  name="initial_payment"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue=""
                  placeholder="1000"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="payment_method">Payment method</Label>
                <select
                  id="payment_method"
                  name="payment_method"
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring cursor-pointer"
                >
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="transfer">Transfer</option>
                  <option value="cheque">Cheque</option>
                </select>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              name="notes"
              defaultValue={editing?.notes ?? ''}
              placeholder="Zones treated, skin type, special instructions…"
            />
          </div>
        </form>

        <DialogFooter>
          <Button
            variant="outline"
            type="button"
            disabled={isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="submit" form="pkg-form" disabled={isPending}>
            {isPending ? 'Saving…' : editing ? 'Save Changes' : 'Create Package'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function PackagesClient({
  packages,
  clients,
  services,
  payments,
}: Props) {
  const [formOpen, setFormOpen] = useState(false)
  const [editingPkg, setEditingPkg] = useState<Pkg | null>(null)
  const [detailPkg, setDetailPkg] = useState<Pkg | null>(null)
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'completed' | 'cancelled'>('all')

  const filtered = useMemo(
    () =>
      statusFilter === 'all'
        ? packages
        : packages.filter((p) => p.status === statusFilter),
    [packages, statusFilter],
  )

  const totalReceived = packages.reduce((s, p) => s + p.paid_amount, 0)
  const totalOutstanding = packages
    .filter((p) => p.status === 'active')
    .reduce((s, p) => s + Math.max(0, p.total_price - p.paid_amount), 0)
  const activeCount = packages.filter((p) => p.status === 'active').length

  function openCreate() {
    setEditingPkg(null)
    setFormOpen(true)
  }

  function openEdit(pkg: Pkg) {
    setDetailPkg(null)
    setEditingPkg(pkg)
    setFormOpen(true)
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Treatment Packages
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage client packages, sessions, and payments
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus />
          New Package
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex items-center gap-4 rounded-xl border border-l-4 border-l-violet-500 bg-card p-5 shadow-sm">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-50">
            <Package className="h-5 w-5 text-violet-600" />
          </div>
          <div>
            <p className="text-3xl font-bold leading-none tracking-tight tabular-nums">{activeCount}</p>
            <p className="mt-1.5 text-xs text-muted-foreground">Active Packages</p>
          </div>
        </div>
        <div className="flex items-center gap-4 rounded-xl border border-l-4 border-l-emerald-500 bg-card p-5 shadow-sm">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          </div>
          <div>
            <p className="text-3xl font-bold leading-none tracking-tight tabular-nums text-emerald-600">{formatDH(totalReceived)}</p>
            <p className="mt-1.5 text-xs text-muted-foreground">Total Received</p>
          </div>
        </div>
        <div className="flex items-center gap-4 rounded-xl border border-l-4 border-l-amber-400 bg-card p-5 shadow-sm">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-50">
            <Clock className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <p className={`text-3xl font-bold leading-none tracking-tight tabular-nums ${totalOutstanding > 0 ? 'text-amber-600' : 'text-muted-foreground'}`}>{formatDH(totalOutstanding)}</p>
            <p className="mt-1.5 text-xs text-muted-foreground">Outstanding Balance</p>
          </div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 rounded-lg border p-1 w-fit text-sm">
        {(['all', 'active', 'completed', 'cancelled'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded px-3 py-1 capitalize transition-colors ${
              statusFilter === s
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-muted'
            }`}
          >
            {s === 'all' ? `All (${packages.length})` : s}
          </button>
        ))}
      </div>

      {/* Packages table */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card py-20 text-center shadow-card">
          <Package className="h-10 w-10 text-muted-foreground/40" />
          <p className="font-medium">No packages yet</p>
          <p className="text-sm text-muted-foreground">
            Create a treatment package to start tracking client sessions and
            payments.
          </p>
          <Button onClick={openCreate} className="mt-2">
            <Plus />
            New Package
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 hover:bg-muted/40">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Client</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Package</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sessions</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Paid / Total</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Balance</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                <th className="w-10 px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((pkg) => {
                const balance = Math.max(0, pkg.total_price - pkg.paid_amount)
                const cfg = STATUS_CFG[pkg.status]
                return (
                  <tr key={pkg.id} className="hover:bg-muted/20">
                    <td className="px-4 py-3">
                      <span className="font-medium">
                        {pkg.client?.name ?? '—'}
                      </span>
                      {pkg.client?.phone && (
                        <span className="block text-xs text-muted-foreground">
                          {pkg.client.phone}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span>{pkg.package_name}</span>
                      {pkg.service && (
                        <span className="block text-xs text-muted-foreground">
                          {pkg.service.name}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 min-w-[120px]">
                      <SessionBar
                        completed={pkg.completed_sessions}
                        total={pkg.total_sessions}
                      />
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      <span className="text-emerald-600">
                        {formatDH(pkg.paid_amount)}
                      </span>
                      <span className="text-muted-foreground">
                        {' '}
                        / {formatDH(pkg.total_price)}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      <span
                        className={balance > 0 ? 'text-amber-600 font-medium' : 'text-muted-foreground'}
                      >
                        {formatDH(balance)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        pkg.status === 'active' ? 'bg-emerald-50 text-emerald-700'
                        : pkg.status === 'completed' ? 'bg-blue-50 text-blue-700'
                        : 'bg-muted text-muted-foreground'
                      }`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${
                          pkg.status === 'active' ? 'bg-emerald-500'
                          : pkg.status === 'completed' ? 'bg-blue-400'
                          : 'bg-muted-foreground/40'
                        }`} />
                        {cfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDetailPkg(pkg)}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Dialogs */}
      <PackageFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editingPkg}
        clients={clients}
        services={services}
      />

      {detailPkg && (
        <PackageDetailDialog
          pkg={detailPkg}
          payments={payments}
          onClose={() => setDetailPkg(null)}
          onEdit={() => openEdit(detailPkg)}
        />
      )}
    </div>
  )
}
