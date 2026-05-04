'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { isAdminEmail } from '@/lib/admin'

type AuthResult = { error?: string; success?: string }

function friendlySignInError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) {
    return 'The email or password you entered is incorrect.'
  }
  if (m.includes('email not confirmed') || m.includes('email_not_confirmed')) {
    return 'Please confirm your email first — check your inbox for the confirmation link.'
  }
  if (m.includes('too many requests') || m.includes('rate limit')) {
    return 'Too many attempts — please wait a moment and try again.'
  }
  if (m.includes('network') || m.includes('fetch')) {
    return 'Network error — check your connection and try again.'
  }
  return message
}

async function getOrigin(): Promise<string> {
  const h = await headers()
  const envOrigin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '')
  if (envOrigin) return envOrigin
  const proto = h.get('x-forwarded-proto') ?? 'http'
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  return `${proto}://${host}`
}

export async function signUp(
  _prev: AuthResult | undefined,
  formData: FormData
): Promise<AuthResult> {
  const supabase = await createClient()

  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const fullName = formData.get('full_name') as string

  const origin = await getOrigin()
  const next = isAdminEmail(email) ? '/admin' : '/dashboard'
  const emailRedirectTo = `${origin}/auth/callback?next=${encodeURIComponent(next)}`

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo,
    },
  })

  if (error) return { error: error.message }

  if (data.session) {
    revalidatePath('/', 'layout')
    redirect(next)
  }

  return {
    success:
      'Almost there — check your inbox and click the confirmation link to finish creating your account.',
  }
}

export async function signIn(
  _prev: AuthResult | undefined,
  formData: FormData
): Promise<AuthResult> {
  const supabase = await createClient()

  const email = formData.get('email') as string
  const password = formData.get('password') as string

  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) return { error: friendlySignInError(error.message) }

  revalidatePath('/', 'layout')
  redirect(isAdminEmail(email) ? '/admin' : '/dashboard')
}

export async function signInAdmin(
  _prev: AuthResult | undefined,
  formData: FormData
): Promise<AuthResult> {
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  if (!isAdminEmail(email)) {
    return { error: 'Unauthorized' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) return { error: friendlySignInError(error.message) }

  revalidatePath('/', 'layout')
  redirect('/admin')
}

export async function requestPasswordReset(
  _prev: AuthResult | undefined,
  formData: FormData
): Promise<AuthResult> {
  const supabase = await createClient()
  const email = (formData.get('email') as string)?.trim()

  if (!email) return { error: 'Please enter your email address.' }

  const origin = await getOrigin()
  const redirectTo = `${origin}/reset-password`

  await supabase.auth.resetPasswordForEmail(email, { redirectTo })

  return {
    success:
      'If an account exists for that email, a password reset link is on its way. Check your inbox.',
  }
}

export async function updatePassword(
  _prev: AuthResult | undefined,
  formData: FormData
): Promise<AuthResult> {
  const password = formData.get('password') as string
  const confirm = formData.get('confirm_password') as string

  if (!password || password.length < 8) {
    return { error: 'Password must be at least 8 characters.' }
  }
  if (password !== confirm) {
    return { error: 'Passwords do not match.' }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      error:
        'Your reset link has expired or is invalid. Request a new one to continue.',
    }
  }

  const { error } = await supabase.auth.updateUser({ password })
  if (error) return { error: error.message }

  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}
