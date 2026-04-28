import type { Metadata } from 'next'
import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { AdminLoginForm } from './login-form'

export const metadata: Metadata = { title: 'Admin sign in' }

export default function AdminLoginPage() {
  return (
    <div className="bg-surface-gradient flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <Link href="/" className="flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            <span className="text-xl font-semibold tracking-tight">GlowBook</span>
          </Link>
        </div>
        <div className="rounded-2xl border border-border bg-card/95 p-8 shadow-card backdrop-blur-sm">
          <div className="mb-7">
            <h1 className="text-2xl font-semibold tracking-tight">Admin sign in</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Restricted area — administrators only
            </p>
          </div>
          <AdminLoginForm />
          <p className="mt-6 text-center text-sm text-muted-foreground">
            Not an administrator?{' '}
            <Link href="/login" className="font-medium text-primary hover:underline">
              Go to user sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
