'use client'

import { useActionState, useState } from 'react'
import { signUp } from '@/actions/auth'
import Link from 'next/link'

type AuthState = { ok: false; error: string } | null
type RegisterFieldErrors = {
  email?: string
  fullName?: string
  password?: string
  consentGiven?: string
}

const initialState: AuthState = null

export function RegisterForm() {
  const [email, setEmail] = useState('')
  const [showDetails, setShowDetails] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<RegisterFieldErrors>({})
  const [state, action, pending] = useActionState(
    async (_prev: AuthState, formData: FormData): Promise<AuthState> => {
      const result = await signUp(formData)
      return result ?? null
    },
    initialState
  )

  return (
    <div className="flex flex-col gap-5">
      {state && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          {state.error}
        </p>
      )}

      {!showDetails ? (
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            const nextEmail = email.trim()

            if (!nextEmail) {
              setFieldErrors({ email: 'Enter your email address.' })
              return
            }

            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
              setFieldErrors({ email: 'Enter a valid email address.' })
              return
            }

            setEmail(nextEmail)
            setFieldErrors({})
            setShowDetails(true)
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="registerEmail" className="text-sm font-semibold text-gray-700">
              Email
            </label>
            <input
              id="registerEmail"
              type="text"
              inputMode="email"
              autoComplete="email"
              placeholder="Type your email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={fieldErrors.email ? 'register-email-error' : undefined}
              className="h-11 rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 aria-invalid:border-red-300 aria-invalid:bg-red-50/40"
            />
            {fieldErrors.email && (
              <p id="register-email-error" className="text-sm font-medium text-red-600">
                {fieldErrors.email}
              </p>
            )}
          </div>

          <button
            type="submit"
            className="h-11 rounded-md bg-gray-950 px-4 text-sm font-bold text-white transition-colors hover:bg-black"
          >
            Create account
          </button>
        </form>
      ) : (
        <form
          action={action}
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            const formData = new FormData(event.currentTarget)
            const fullName = String(formData.get('fullName') ?? '').trim()
            const password = String(formData.get('password') ?? '')
            const consentGiven = formData.get('consentGiven') === 'true'

            if (!fullName) {
              event.preventDefault()
              setFieldErrors({ fullName: 'Enter your full name.' })
              return
            }

            if (password.length < 8) {
              event.preventDefault()
              setFieldErrors({ password: 'Use a password with at least 8 characters.' })
              return
            }

            if (!consentGiven) {
              event.preventDefault()
              setFieldErrors({ consentGiven: 'Accept the privacy policy to continue.' })
              return
            }

            setFieldErrors({})
          }}
        >
          <input type="hidden" name="email" value={email} />

          <div className="flex flex-col gap-1.5">
            <label htmlFor="fullName" className="text-sm font-semibold text-gray-700">
              Full name
            </label>
            <input
              id="fullName"
              name="fullName"
              type="text"
              autoComplete="name"
              placeholder="Type your name"
              aria-invalid={Boolean(fieldErrors.fullName)}
              aria-describedby={fieldErrors.fullName ? 'full-name-error' : undefined}
              className="h-11 rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 aria-invalid:border-red-300 aria-invalid:bg-red-50/40"
            />
            {fieldErrors.fullName && (
              <p id="full-name-error" className="text-sm font-medium text-red-600">
                {fieldErrors.fullName}
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
              autoComplete="new-password"
              placeholder="Create a password"
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby={fieldErrors.password ? 'register-password-error' : undefined}
              className="h-11 rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 aria-invalid:border-red-300 aria-invalid:bg-red-50/40"
            />
            {fieldErrors.password && (
              <p id="register-password-error" className="text-sm font-medium text-red-600">
                {fieldErrors.password}
              </p>
            )}
          </div>

          <div className="flex items-start gap-2">
            <input
              id="consentGiven"
              name="consentGiven"
              type="checkbox"
              value="true"
              aria-invalid={Boolean(fieldErrors.consentGiven)}
              aria-describedby={fieldErrors.consentGiven ? 'consent-error' : undefined}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-brand"
            />
            <label htmlFor="consentGiven" className="text-sm leading-snug text-gray-600">
              I have read the{' '}
              <Link href="/datenschutz" className="font-medium text-brand underline" target="_blank">
                privacy policy
              </Link>{' '}
              and agree to the processing of my data.
            </label>
          </div>
          {fieldErrors.consentGiven && (
            <p id="consent-error" className="text-sm font-medium text-red-600">
              {fieldErrors.consentGiven}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="h-11 rounded-md bg-gray-950 px-4 text-sm font-bold text-white transition-colors hover:bg-black disabled:opacity-50"
          >
            {pending ? 'Creating account...' : 'Create account'}
          </button>

          {/* Said BEFORE the button is pressed, not only afterwards on the
              sign-in page: the confirmation step is the one thing about this
              form that does not happen on screen, and a student who does not
              expect it reads the failed sign-in that follows as a wrong
              password. */}
          <p className="text-sm leading-snug text-gray-500">
            We&rsquo;ll email you a confirmation link. Open it before your first sign-in.
          </p>
        </form>
      )}

      <p className="text-center text-sm text-gray-500">
        Already have an account?{' '}
        <Link href="/auth/login" className="font-medium text-brand underline">
          Sign in
        </Link>
      </p>
    </div>
  )
}
