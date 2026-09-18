import type { KursSoldAs } from '@/types'
import { purchasePriceLabel } from '@/lib/pricing'

interface Props {
  unitId: string
  title: string
  description: string | null
  canceled?: boolean
  kursId: string
  kursTitle: string
  /** Decides what this page sells: this Einheit, or the Kurs it sits in. */
  soldAs: KursSoldAs
  /** The whole-Kurs price in cents; ignored when Einheiten are sold singly. */
  kursPriceCents: number
}

/**
 * The locked Einheit's offer.
 *
 * It sells one of two things and says which: a Kurs with `sold_as = 'kurs'` is
 * only for sale entire, so the button posts to the Kurs checkout and the copy
 * promises every Einheit rather than this one. The price comes from
 * `purchasePriceLabel`, which is the same rule the sidebar badge uses.
 */
export default function UnitPaywall({
  unitId,
  title,
  description,
  canceled,
  kursId,
  kursTitle,
  soldAs,
  kursPriceCents,
}: Props) {
  const wholeKurs = soldAs === 'kurs'
  return (
    <div className="mx-auto mt-8 max-w-xl rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
      <div className="flex items-center gap-3">
        <span aria-hidden className="text-2xl">🔒</span>
        <h2 className="text-lg font-semibold text-gray-900">Unit locked</h2>
      </div>
      <p className="mt-3 text-sm text-gray-600">
        {wholeKurs ? (
          <>
            <span className="font-medium text-gray-900">{title}</span> is part of{' '}
            <span className="font-medium text-gray-900">{kursTitle}</span>. Unlock the full course
            to access every unit in it — including units added later.
          </>
        ) : (
          <>
            Unlock <span className="font-medium text-gray-900">{title}</span> to access all tasks
            and documents in this unit.
          </>
        )}
      </p>
      {description && (
        <p className="mt-2 text-xs text-gray-500">{description}</p>
      )}

      {canceled && (
        <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Payment canceled. You can try again at any time.
        </p>
      )}

      <form
        action={wholeKurs ? `/api/checkout/kurs/${kursId}` : `/api/checkout/${unitId}`}
        method="post"
        className="mt-6"
      >
        <button
          type="submit"
          className="w-full rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand/90 transition-colors btn-brand"
        >
          Unlock – {purchasePriceLabel(soldAs, kursPriceCents)}
        </button>
      </form>

      <p className="mt-3 text-center text-[11px] text-gray-400">
        Secure payment via Stripe. One-time payment — permanent access.
      </p>

      {/* ⚠ LIABILITY DISCLAIMER. Translated with the rest of the student UI,
          but the German original was legal wording — have it reviewed before
          this reaches real customers. */}
      <p className="mt-2 text-center text-[11px] text-gray-400">
        All study material is provided without warranty of accuracy or completeness. Errors cannot be ruled out.
      </p>
    </div>
  )
}
