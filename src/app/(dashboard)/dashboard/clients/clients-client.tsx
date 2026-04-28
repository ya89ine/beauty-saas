'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, MoreHorizontal, Pencil, Trash2, Users, Mail, Phone } from 'lucide-react'

function getInitials(name: string): string {
  return name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
}
import { toast } from 'sonner'
import type { Client } from '@/types/database'
import { createClient_, updateClient_, deleteClient_ } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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
  clients: Client[]
}

export function ClientsClient({ clients }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Client | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function openCreate() {
    setEditing(null)
    setFormError(null)
    setOpen(true)
  }

  function openEdit(c: Client) {
    setEditing(c)
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
        ? await updateClient_(editing.id, formData)
        : await createClient_(formData)

      if (result.error) {
        setFormError(result.error)
        return
      }
      setOpen(false)
      toast.success(editing ? 'Client updated' : 'Client added')
      router.refresh()
    })
  }

  function handleDelete(c: Client) {
    if (!confirm(`Delete "${c.name}"? This cannot be undone.`)) return

    startTransition(async () => {
      const result = await deleteClient_(c.id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Client deleted')
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Clients</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            View and manage your client database
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus />
          Add Client
        </Button>
      </div>

      {clients.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card py-24 text-center shadow-card">
          <Users className="h-10 w-10 text-muted-foreground/40" />
          <p className="font-medium">No clients yet</p>
          <p className="text-sm text-muted-foreground">
            Add your first client to start tracking their history.
          </p>
          <Button onClick={openCreate} className="mt-2">
            <Plus />
            Add Client
          </Button>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card shadow-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Name</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Email</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Phone</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Date of birth</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((c) => (
                <TableRow key={c.id} className="hover:bg-muted/30">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {getInitials(c.name)}
                      </div>
                      <span className="font-medium">{c.name}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {c.email
                      ? <span className="flex items-center gap-1.5 text-muted-foreground text-sm"><Mail className="h-3 w-3 shrink-0" />{c.email}</span>
                      : <span className="text-muted-foreground/40">—</span>}
                  </TableCell>
                  <TableCell>
                    {c.phone
                      ? <span className="flex items-center gap-1.5 text-muted-foreground text-sm"><Phone className="h-3 w-3 shrink-0" />{c.phone}</span>
                      : <span className="text-muted-foreground/40">—</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c.date_of_birth ?? <span className="text-muted-foreground/40">—</span>}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" />}>
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">Actions</span>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(c)}>
                          <Pencil />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={() => handleDelete(c)}>
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
            <DialogTitle>{editing ? 'Edit Client' : 'Add Client'}</DialogTitle>
          </DialogHeader>

          <form
            key={editing?.id ?? 'new'}
            id="client-form"
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
                placeholder="Sara Benali"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  defaultValue={editing?.email ?? ''}
                  placeholder="sara@example.com"
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
              <Label htmlFor="date_of_birth">Date of birth</Label>
              <Input
                id="date_of_birth"
                name="date_of_birth"
                type="date"
                defaultValue={editing?.date_of_birth ?? ''}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                name="notes"
                defaultValue={editing?.notes ?? ''}
                placeholder="Allergies, preferences…"
              />
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
            <Button type="submit" form="client-form" disabled={isPending}>
              {isPending ? 'Saving…' : editing ? 'Save Changes' : 'Add Client'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
