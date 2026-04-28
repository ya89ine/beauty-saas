'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, MoreHorizontal, Pencil, Trash2, UserCheck, Mail } from 'lucide-react'

function getInitials(name: string): string {
  return name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
}

const ROLE_COLORS: Record<string, { bg: string; text: string }> = {
  owner:   { bg: 'bg-violet-100', text: 'text-violet-700' },
  manager: { bg: 'bg-blue-100',   text: 'text-blue-700'   },
  staff:   { bg: 'bg-slate-100',  text: 'text-slate-600'  },
}
import { toast } from 'sonner'
import type { Staff } from '@/types/database'
import { createStaff, updateStaff, deleteStaff } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

const ROLE_LABELS: Record<Staff['role'], string> = {
  owner: 'Owner',
  manager: 'Manager',
  staff: 'Staff',
}

interface Props {
  staffList: Staff[]
}

export function StaffClient({ staffList }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Staff | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function openCreate() {
    setEditing(null)
    setFormError(null)
    setOpen(true)
  }

  function openEdit(s: Staff) {
    setEditing(s)
    setFormError(null)
    setOpen(true)
  }

  function handleOpenChange(next: boolean) {
    if (!isPending) setOpen(next)
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)

    startTransition(async () => {
      const result = editing
        ? await updateStaff(editing.id, formData)
        : await createStaff(formData)

      if (result.error) {
        setFormError(result.error)
        return
      }
      setOpen(false)
      toast.success(editing ? 'Staff member updated' : 'Staff member added')
      router.refresh()
    })
  }

  function handleDelete(s: Staff) {
    if (s.role === 'owner') {
      toast.error('Cannot delete the clinic owner')
      return
    }
    if (!confirm(`Remove "${s.name}" from the team?`)) return

    startTransition(async () => {
      const result = await deleteStaff(s.id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Staff member removed')
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Staff</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your team members and their roles
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus />
          Add Staff
        </Button>
      </div>

      {staffList.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border bg-card py-24 text-center shadow-sm">
          <UserCheck className="h-10 w-10 text-muted-foreground/40" />
          <p className="font-medium">No staff members yet</p>
          <p className="text-sm text-muted-foreground">
            Add team members to assign them to appointments.
          </p>
          <Button onClick={openCreate} className="mt-2">
            <Plus />
            Add Staff
          </Button>
        </div>
      ) : (
        <div className="rounded-xl border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Name</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Email</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Phone</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Role</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {staffList.map((s) => {
                const roleColor = ROLE_COLORS[s.role] ?? ROLE_COLORS.staff
                return (
                <TableRow key={s.id} className="hover:bg-muted/30">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${roleColor.bg} ${roleColor.text}`}>
                        {getInitials(s.name)}
                      </div>
                      <span className="font-medium">{s.name}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5 text-muted-foreground text-sm">
                      <Mail className="h-3 w-3 shrink-0" />{s.email}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{s.phone ?? <span className="text-muted-foreground/40">—</span>}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${roleColor.bg} ${roleColor.text}`}>
                      {ROLE_LABELS[s.role]}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      s.is_active
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-muted text-muted-foreground'
                    }`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${s.is_active ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
                      {s.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" />}>
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">Actions</span>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(s)}>
                          <Pencil />
                          Edit
                        </DropdownMenuItem>
                        {s.role !== 'owner' && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => handleDelete(s)}
                            >
                              <Trash2 />
                              Remove
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              )})}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Staff Member' : 'Add Staff Member'}</DialogTitle>
          </DialogHeader>

          <form
            key={editing?.id ?? 'new'}
            id="staff-form"
            onSubmit={handleSubmit}
            className="flex flex-col gap-4"
          >
            {formError && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {formError}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Full name *</Label>
              <Input
                id="name"
                name="name"
                required
                defaultValue={editing?.name}
                placeholder="Fatima Zahra"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Email *</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  defaultValue={editing?.email}
                  placeholder="fatima@studio.com"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  name="phone"
                  type="tel"
                  defaultValue={editing?.phone ?? ''}
                  placeholder="+212 6 00 00 00 00"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="role">Role</Label>
              <select
                id="role"
                name="role"
                defaultValue={editing?.role ?? 'staff'}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring cursor-pointer"
              >
                <option value="owner">Owner</option>
                <option value="manager">Manager</option>
                <option value="staff">Staff</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_active"
                name="is_active"
                defaultChecked={editing ? editing.is_active : true}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              <Label htmlFor="is_active">Active</Label>
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
            <Button type="submit" form="staff-form" disabled={isPending}>
              {isPending ? 'Saving…' : editing ? 'Save Changes' : 'Add Staff'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
