'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import {
  Calendar,
  Users,
  Scissors,
  UserCheck,
  LayoutDashboard,
  Settings,
  Sparkles,
  LogOut,
  ChevronDown,
  TrendingUp,
  Package,
  BarChart2,
} from 'lucide-react'
import { signOut } from '@/lib/actions/auth'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  SidebarTrigger,
  SidebarInset,
} from '@/components/ui/sidebar'

const navItems = [
  { href: '/dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { href: '/dashboard/appointments', label: 'Appointments', Icon: Calendar },
  { href: '/dashboard/clients', label: 'Clients', Icon: Users },
  { href: '/dashboard/staff', label: 'Staff', Icon: UserCheck },
  { href: '/dashboard/services', label: 'Services', Icon: Scissors },
  { href: '/dashboard/packages', label: 'Packages', Icon: Package },
  { href: '/dashboard/revenue', label: 'Revenue', Icon: TrendingUp },
  { href: '/dashboard/staff-performance', label: 'Performance', Icon: BarChart2 },
  { href: '/dashboard/settings', label: 'Settings', Icon: Settings },
]

interface Props {
  user: User
  clinic: { id: string; name: string; slug: string } | null
  children: React.ReactNode
}

export function DashboardShell({ user, clinic, children }: Props) {
  const pathname = usePathname()
  const router = useRouter()

  const displayName = user.user_metadata?.full_name as string | undefined
  const initials =
    displayName
      ?.split(' ')
      .map((n: string) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() ??
    user.email?.[0].toUpperCase() ??
    '?'

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="border-b px-4 py-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <span className="font-semibold tracking-tight">GlowBook</span>
          </div>
          {clinic && (
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {clinic.name}
            </p>
          )}
        </SidebarHeader>

        <SidebarContent className="p-2">
          <SidebarMenu>
            {navItems.map(({ href, label, Icon }) => {
              const active =
                href === '/dashboard'
                  ? pathname === '/dashboard'
                  : pathname.startsWith(href)
              return (
                <SidebarMenuItem key={href}>
                  {/* base-ui uses render prop instead of asChild */}
                  <SidebarMenuButton
                    render={<Link href={href} />}
                    isActive={active}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </SidebarContent>

        <SidebarFooter className="border-t p-3">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  className="h-auto w-full justify-start gap-3 px-3 py-2"
                />
              }
            >
              <Avatar className="h-7 w-7 shrink-0">
                <AvatarFallback className="bg-primary text-xs text-primary-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-col text-left">
                <span className="truncate text-sm font-medium">
                  {displayName ?? 'Account'}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {user.email}
                </span>
              </div>
              <ChevronDown className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
            </DropdownMenuTrigger>

            <DropdownMenuContent side="top" align="start" className="w-56">
              <DropdownMenuItem
                onClick={() => router.push('/dashboard/settings')}
              >
                Settings
              </DropdownMenuItem>
              {clinic && (
                <DropdownMenuItem
                  onClick={() =>
                    window.open(`/book/${clinic.slug}`, '_blank')
                  }
                >
                  View booking page
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => signOut()}
              >
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <header className="flex h-14 items-center border-b px-4 lg:hidden">
          <SidebarTrigger />
          <div className="ml-3 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="font-semibold">GlowBook</span>
          </div>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}
