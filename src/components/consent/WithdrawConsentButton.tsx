'use client'

import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { withdrawConsent } from '@/actions/auth'

export function WithdrawConsentButton() {
  const router = useRouter()
  const [state, action, pending] = useActionState(
    async (_prev: { done: boolean }) => {
      await withdrawConsent()
      return { done: true }
    },
    { done: false }
  )

  useEffect(() => {
    if (state.done) {
      router.push('/auth/login?notice=consent-withdrawn')
    }
  }, [state.done, router])

  return (
    <form action={action}>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
      >
        {pending ? 'Wird verarbeitet…' : 'Einwilligung widerrufen'}
      </button>
    </form>
  )
}
