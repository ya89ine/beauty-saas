'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isAdminEmail } from '@/lib/admin'

type AuthResult = { error?: string; success?: string }

export async function signUp(
  _prev: AuthResult | undefined,
  formData: FormData
): Promise<AuthResult> {
  const supabase = await createClient()

  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const fullName = formData.get('full_name') as string

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  })

  if (error) return { error: error.message }
  return { success: 'Check your email to confirm your account.' }
}

export async function signIn(
  _prev: AuthResult | undefined,
  formData: FormData
): Promise<AuthResult> {
  const supabase = await createClient()

  const email = formData.get('email') as string
  const password = formData.get('password') as string

  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) return { error: error.message }

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

  if (error) return { error: error.message }

  revalidatePath('/', 'layout')
  redirect('/admin')
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}
