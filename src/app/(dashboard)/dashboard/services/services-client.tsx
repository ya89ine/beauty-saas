'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, MoreHorizontal, Pencil, Trash2, Scissors } from 'lucide-react'
import { toast } from 'sonner'
import type { Service } from '@/types/database'
import { createService, updateService, deleteService } from './actions'
import { SERVICE_PALETTE, getServiceHex } from '@/lib/service-colors'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface Props {
  services: Service[]
}

export function ServicesClient({ services }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Service | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [color, setColor] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function openCreate() {
    setEditing(null)
    setFormError(null)
    setColor(null)
    setOpen(true)
  }

  function openEdit(service: Service) {
    setEditing(service)
    setFormError(null)
    setColor(service.color ?? null)
    setOpen(true)
  }

  function handleOpenChange(next: boolean) {
    if (!isPending) setOpen(next)
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    formData.set('color', color ?? '')

    startTransition(async () => {
      const result = editing
        ? await updateService(editing.id, formData)
        : await createService(formData)

      if (result.error) {
        setFormError(result.error)
        return
      }

      setOpen(false)
      toast.success(editing ? 'Service updated' : 'Service created')
      router.refresh()
    })
  }

  function handleDelete(service: Service) {
    if (!confirm(`Delete "${service.name}"? This cannot be undone.`)) return

    startTransition(async () => {
      const result = await deleteService(service.id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Service deleted')
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Services</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure the treatments you offer and their pricing
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus />
          Add Service
        </Button>
      </div>

      {services.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card py-24 text-center shadow-card">
          <Scissors className="h-10 w-10 text-muted-foreground/40" />
          <p className="font-medium">No services yet</p>
          <p className="text-sm text-muted-foreground">
            Add your first service to start accepting bookings.
          </p>
          <Button onClick={openCreate} className="mt-2">
            <Plus />
            Add Service
          </Button>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card shadow-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Name</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Category</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Duration</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Price</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {services.map((service) => (
                <TableRow key={service.id} className="hover:bg-muted/30">
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-foreground/10"
                        style={{ backgroundColor: getServiceHex(service) }}
                      />
                      <span className="font-medium">{service.name}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {service.category
                      ? <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">{service.category}</span>
                      : <span className="text-muted-foreground/40">—</span>}
                  </TableCell>
                  <TableCell>
                    <span className="tabular-nums text-muted-foreground">{service.duration_minutes} min</span>
                  </TableCell>
                  <TableCell>
                    <span className="font-medium tabular-nums">
                      {Number(service.price).toLocaleString('fr-MA', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} DH
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      service.is_active
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-muted text-muted-foreground'
                    }`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${service.is_active ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
                      {service.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={<Button variant="ghost" size="icon" />}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">Actions</span>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(service)}>
                          <Pencil />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => handleDelete(service)}
                        >
                          <Trash2 />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Service' : 'Add Service'}</DialogTitle>
          </DialogHeader>

          <form
            key={editing?.id ?? 'new'}
            id="service-form"
            onSubmit={handleSubmit}
            className="flex flex-col gap-4"
          >
            {formError && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {formError}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                name="name"
                required
                defaultValue={editing?.name}
                placeholder="e.g. Haircut & Style"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="category">Category</Label>
              <Input
                id="category"
                name="category"
                defaultValue={editing?.category ?? ''}
                placeholder="e.g. Hair, Nails, Skin"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                name="description"
                defaultValue={editing?.description ?? ''}
                placeholder="Optional description…"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="duration_minutes">Duration (min)</Label>
                <Input
                  id="duration_minutes"
                  name="duration_minutes"
                  type="number"
                  required
                  min={1}
                  defaultValue={editing?.duration_minutes ?? 60}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="price">Price (USD)</Label>
                <Input
                  id="price"
                  name="price"
                  type="number"
                  required
                  min={0}
                  step="0.01"
                  defaultValue={editing?.price ?? 0}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Color</Label>
              <div className="flex flex-wrap items-center gap-1.5">
                {SERVICE_PALETTE.map((swatch) => {
                  const selected = color?.toUpperCase() === swatch.hex.toUpperCase()
                  return (
                    <button
                      key={swatch.hex}
                      type="button"
                      onClick={() => setColor(selected ? null : swatch.hex)}
                      aria-label={swatch.label}
                      aria-pressed={selected}
                      title={swatch.label}
                      className={`h-7 w-7 rounded-full transition-all ${
                        selected
                          ? 'ring-2 ring-offset-2 ring-foreground/60 scale-105'
                          : 'ring-1 ring-foreground/10 hover:scale-110'
                      }`}
                      style={{ backgroundColor: swatch.hex }}
                    />
                  )
                })}
                {color && (
                  <button
                    type="button"
                    onClick={() => setColor(null)}
                    className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                  >
                    Auto
                  </button>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {color
                  ? 'Custom color selected.'
                  : 'Auto: derived from category (laser/peeling/facial/slimming) or assigned automatically.'}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_active"
                name="is_active"
                defaultChecked={editing ? editing.is_active : true}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              <Label htmlFor="is_active">Active (visible to clients)</Label>
            </div>
          </form>

          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              disabled={isPending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" form="service-form" disabled={isPending}>
              {isPending
                ? 'Saving…'
                : editing
                  ? 'Save Changes'
                  : 'Create Service'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
