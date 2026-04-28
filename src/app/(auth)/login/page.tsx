import type { Metadata } from 'next'
import Link from 'next/link'
import { LoginForm } from './login-form'

export const metadata: Metadata = { title: 'Sign in' }

export default function LoginPage() {
  return (
    <div className="rounded-2xl border border-border bg-card/95 p-8 shadow-card backdrop-blur-sm">
      <div className="mb-7">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Sign in to your GlowBook dashboard
        </p>
      </div>
      <LoginForm />
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{' '}
        <Link href="/signup" className="font-medium text-primary hover:underline">
          Sign up
        </Link>
      </p>
    </div>
  )
}
