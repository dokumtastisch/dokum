'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient as createSupabaseAdminClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { SignInSchema, SignUpSchema } from '@/lib/schemas'
import type { ActionResult } from '@/types'

type OAuthProvider = 'google' | 'github' | 'apple'

/**
 * Supabase's auth errors, turned into something a person can act on.
 *
 * Two rules behind the wording:
 *
 *   „Invalid email or password" stays DELIBERATELY VAGUE for a failed sign-in.
 *   Saying „no account with that address" would turn the form into a tool for
 *   checking who has an account here.
 *
 *   „Email not confirmed" is the opposite case and must NOT hide behind that:
 *   the person knows they just signed up, and telling them their password is
 *   wrong sends them to reset a password that was fine. This is the one that
 *   cost an afternoon.
 *
 * Anything unmapped falls back to a plain sentence rather than Supabase's raw
 * text, which is English-only, sometimes technical, and not ours to show.
 */
function authErrorMessage(
  error: { code?: string; status?: number; message?: string },
  fallback: string,
): string {
  switch (error.code) {
    case 'email_not_confirmed':
      return 'Confirm your email address first — we sent you a link when you signed up.'
    case 'invalid_credentials':
      return 'Invalid email or password.'
    case 'user_already_exists':
    case 'email_exists':
      return 'An account with this email already exists. Sign in instead.'
    case 'weak_password':
      return 'Please choose a stronger password — at least 8 characters.'
    case 'signup_disabled':
      return 'New accounts are currently closed.'
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'Too many attempts. Please wait a minute and try again.'
  }
  if (error.status === 429) return 'Too many attempts. Please wait a minute and try again.'
  return fallback
}

export async function signInWithOAuth(provider: OAuthProvider) {
  const supabase = await createClient()
  const headerStore = await headers()
  const rawOrigin = headerStore.get('origin') ?? process.env.NEXT_PUBLIC_SITE_URL ?? ''
  const origin = rawOrigin.startsWith('http') ? rawOrigin : `https://${rawOrigin}`

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${origin}/auth/callback`,
    },
  })

  if (error || !data.url) {
    redirect('/auth/login?notice=oauth-failed')
  }

  redirect(data.url)
}

export async function signIn(formData: FormData) {
  const result = SignInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!result.success) return { ok: false as const, error: result.error.issues[0].message }
  const { email, password } = result.data

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return {
      ok: false as const,
      error: authErrorMessage(error, 'Invalid email or password.'),
    }
  }

  redirect('/kurse')
}

export async function signUp(formData: FormData) {
  const result = SignUpSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    full_name: formData.get('fullName'),
  })
  if (!result.success) return { ok: false as const, error: result.error.issues[0].message }
  const { email, password, full_name } = result.data

  const consentGiven = formData.get('consentGiven') === 'true'

  if (!consentGiven) {
    return { ok: false as const, error: 'Please accept the privacy policy to continue.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: full_name ?? null, consent_accepted_at: new Date().toISOString() } },
  })

  if (error) {
    return {
      ok: false as const,
      error: authErrorMessage(error, 'Could not create your account. Please try again.'),
    }
  }
  redirect('/auth/login?notice=confirm-email')
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/auth/login')
}

export async function deleteAccount(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const confirmation = String(formData.get('confirmation') ?? '').trim()
  if (!user.email || confirmation !== user.email) {
    return { ok: false, error: 'Type your email address exactly to confirm account deletion.' }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    return {
      ok: false,
      error: 'Account deletion is not configured yet. Add SUPABASE_SERVICE_ROLE_KEY on the server.',
    }
  }

  const admin = createSupabaseAdminClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  const { error } = await admin.auth.admin.deleteUser(user.id)
  if (error) return { ok: false, error: error.message }

  await supabase.auth.signOut()
  redirect('/auth/login?notice=account-deleted')
}

export async function acceptConsent() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { error } = await supabase.auth.updateUser({
    data: { consent_accepted_at: new Date().toISOString() },
  })
  if (error) redirect('/')
  redirect('/')
}

export async function withdrawConsent() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  await supabase.auth.updateUser({ data: { consent_accepted_at: null } })
  await supabase.auth.signOut()
  return {}
}
