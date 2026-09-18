'use client'

import { useActionState, useState } from 'react'
import { signIn } from '@/actions/auth'
import Link from 'next/link'
import type { AuthNotice } from '@/lib/auth-notices'

type AuthState = { ok: false; error: string } | null
type LoginFieldErrors = {
  email?: string
  password?: string
}

const initialState: AuthState = null

export function LoginForm({ notice }: { notice?: AuthNotice | null }) {
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({})
  const [state, action, pending] = useActionState(
    async (_prev: AuthState, formData: FormData): Promise<AuthState> => {
      const result = await signIn(formData)
      return result ?? null
    },
    initialState
  )

  return (
    <div className="flex flex-col gap-5">
      {/* Same two boxes as before — a notice that reports a FAILURE just uses
          the red one instead of being announced in green. */}
      {notice && (
        <p
          className={
            notice.tone === 'error'
              ? 'rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700'
              : 'text-sm text-green-600 bg-green-50 border border-green-200 rounded-md px-3 py-2'
          }
        >
          {notice.text}
        </p>
      )}

      {state && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          {state.error}
        </p>
      )}

      <form
        action={action}
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          const formData = new FormData(event.currentTarget)
          const email = String(formData.get('email') ?? '').trim()
          const password = String(formData.get('password') ?? '')

          if (!email) {
            event.preventDefault()
            setFieldErrors({ email: 'Enter your email address.' })
            return
          }

          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            event.preventDefault()
            setFieldErrors({ email: 'Enter a valid email address.' })
            return
          }

          if (!password) {
            event.preventDefault()
            setFieldErrors({ password: 'Enter your password.' })
            return
          }

          setFieldErrors({})
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-sm font-semibold text-gray-700">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="text"
            inputMode="email"
            autoComplete="email"
            placeholder="Type your email"
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? 'email-error' : undefined}
            className="h-11 rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 aria-invalid:border-red-300 aria-invalid:bg-red-50/40"
          />
          {fieldErrors.email && (
            <p id="email-error" className="text-sm font-medium text-red-600">
              {fieldErrors.email}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-sm font-semibold text-gray-700">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="Type your password"
            aria-invalid={Boolean(fieldErrors.password)}
            aria-describedby={fieldErrors.password ? 'password-error' : undefined}
            className="h-11 rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 aria-invalid:border-red-300 aria-invalid:bg-red-50/40"
          />
          {fieldErrors.password && (
            <p id="password-error" className="text-sm font-medium text-red-600">
              {fieldErrors.password}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={pending}
          className="h-11 rounded-md bg-gray-950 px-4 text-sm font-bold text-white transition-colors hover:bg-black disabled:opacity-50"
        >
          {pending ? 'Signing in...' : 'Sign in'}
        </button>
      </form>

      <p className="text-center text-sm text-gray-500">
        No account?{' '}
        <Link href="/auth/register" className="font-medium text-brand underline">
          Register
        </Link>
      </p>
    </div>
  )
}
