import type { Metadata } from 'next'
import Link from 'next/link'
import { SignupForm } from './signup-form'

export const metadata: Metadata = { title: 'Create account' }

export default function SignupPage() {
  return (
    <div className="rounded-2xl border border-border bg-card/95 p-8 shadow-card backdrop-blur-sm">
      <div className="mb-7">
        <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Start your 14-day free trial — no credit card required
        </p>
      </div>
      <SignupForm />
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  )
}
