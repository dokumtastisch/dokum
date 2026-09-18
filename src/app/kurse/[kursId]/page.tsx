import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Lock } from 'lucide-react'
import { getKursNavTree, getKursViewerAccess } from '@/lib/dal'
import ShareButton from '@/components/ShareButton'
import { UNIT_PRICE_DISPLAY } from '@/lib/constants'
import { purchasePriceLabel } from '@/lib/pricing'

/**
 * The Kurs landing content (#106) — what fills the right-hand column before the
 * student has picked an Einheit.
 *
 * The grid of Unit cards that used to live here is gone: navigating the Kurs is
 * the sidebar's job now, and it is mounted by the layout. What remains is the
 * part navigation cannot do — introduce the Kurs, and sell the Einheiten that
 * are still locked.
 *
 * Both reads are the ones the layout already made. `cache()` on them means this
 * costs no extra round trip, which is why the page re-derives `locked` instead
 * of the layout passing it down (a layout cannot pass props to a page).
 */
export default async function KursPage({
  params,
  searchParams,
}: {
  params: Promise<{ kursId: string }>
  // `?canceled=1` is where Stripe returns a buyer who abandoned a whole-Kurs
  // checkout — the Einheit page handles the same flag for a single Einheit.
  searchParams: Promise<{ canceled?: string }>
}) {
  const [{ kursId }, { canceled }] = await Promise.all([params, searchParams])

  const [kurs, { isAdmin, entitledUnitIds, entitledKursIds }] = await Promise.all([
    getKursNavTree(kursId),
    getKursViewerAccess(),
  ])
  if (!kurs) notFound()

  const kursEntitled = entitledKursIds.has(kursId)
  const lockedUnits = kurs.units.filter(
    (unit) => !isAdmin && !kursEntitled && !entitledUnitIds.has(unit.id)
  )
  // A Kurs sold as a whole makes ONE offer, here, for everything below it. A
  // Kurs sold Einheit by Einheit makes its offer on each Einheit's own page,
  // which is why the list below only links there.
  const sellsWholeKurs = kurs.sold_as === 'kurs' && lockedUnits.length > 0

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-black tracking-[0] text-black">{kurs.title}</h1>
          {kurs.description && (
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-gray-600">{kurs.description}</p>
          )}
          {/* ⚠ LIABILITY DISCLAIMER — see UnitPaywall: translated with the rest
              of the student UI, but it needs a legal review. */}
          <p className="mt-3 max-w-2xl text-xs text-gray-400">
            All study material is provided without warranty of accuracy or completeness. Errors
            cannot be ruled out.
          </p>
        </div>
        <ShareButton title={kurs.title} />
      </div>

      {kurs.units.length === 0 && (
        <p className="mt-10 text-sm text-gray-500">This course has no units yet.</p>
      )}

      {/* Suppressed while the Kurs is locked: it asks for something that cannot
          be done yet, and the offer below is the actual next step. */}
      {kurs.units.length > 0 && !sellsWholeKurs && (
        <p className="mt-8 text-sm text-gray-500">
          Pick a unit on the left to open its tasks and documents.
        </p>
      )}

      {sellsWholeKurs && (
        <section className="mt-10 max-w-2xl rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
          <div className="flex items-center gap-3">
            <Lock aria-hidden className="h-5 w-5 text-gray-500" strokeWidth={2} />
            <h2 className="text-lg font-semibold text-gray-900">Course locked</h2>
          </div>
          <p className="mt-3 text-sm text-gray-600">
            Unlock <span className="font-medium text-gray-900">{kurs.title}</span> to access every
            unit in this course — including units added later.
          </p>

          {/* The Einheiten live INSIDE the offer rather than in a second panel
              below it: they are what is being bought, and saying „locked" twice
              in two framed boxes read as two problems instead of one price. */}
          <h3 className="mt-6 text-xs font-bold uppercase tracking-[0.14em] text-gray-400">
            What you get
          </h3>
          <ul className="mt-2 space-y-1.5">
            {kurs.units.map((unit) => (
              <li key={unit.id} className="flex items-center gap-2.5 text-sm text-gray-500">
                <Lock aria-hidden className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
                <span className="min-w-0 truncate">{unit.title}</span>
              </li>
            ))}
          </ul>

          {canceled === '1' && (
            <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Payment canceled. You can try again at any time.
            </p>
          )}

          <form action={`/api/checkout/kurs/${kursId}`} method="post" className="mt-6">
            <button
              type="submit"
              className="w-full rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand/90 transition-colors btn-brand"
            >
              Unlock – {purchasePriceLabel(kurs.sold_as, kurs.price_cents)}
            </button>
          </form>

          <p className="mt-3 text-center text-[11px] text-gray-400">
            Secure payment via Stripe. One-time payment — permanent access.
          </p>
        </section>
      )}

      {!sellsWholeKurs && lockedUnits.length > 0 && (
        <section className="mt-10 max-w-2xl">
          <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-gray-400">
            Not unlocked yet
          </h2>
          <ul className="mt-3 divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white">
            {lockedUnits.map((unit) => (
              <li key={unit.id}>
                <Link
                  href={`/kurse/${kursId}/units/${unit.id}`}
                  className="flex items-start gap-4 px-5 py-4 transition-colors hover:bg-gray-50"
                >
                  <span aria-hidden className="mt-0.5 text-base">
                    🔒
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-black">{unit.title}</span>
                    {unit.description && (
                      <span className="mt-1 block text-sm leading-snug text-gray-600">
                        {unit.description}
                      </span>
                    )}
                    <span className="mt-1.5 block text-xs font-bold text-brand">Unlock →</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-brand px-2 py-0.5 text-[11px] font-bold text-white">
                    {UNIT_PRICE_DISPLAY}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}
