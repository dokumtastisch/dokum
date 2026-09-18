import { notFound } from 'next/navigation'
import { getKursNavTree, getKursViewerAccess } from '@/lib/dal'
import { KursSidebar } from '@/components/kurse/KursSidebar'
import { DocumentRevealProvider } from '@/components/kurse/document-reveal'
import { RecentKursTracker } from '@/components/kurse/RecentKursTracker'
import { purchasePriceLabel } from '@/lib/pricing'

/**
 * The shell every page inside a Kurs renders into (#106): navigation tree on
 * the left, content on the right.
 *
 * IT IS A LAYOUT AND NOT A COMPONENT EACH PAGE IMPORTS, because that is what
 * keeps the sidebar MOUNTED across navigation. Moving from one Einheit to the
 * next re-renders only `children`; the tree keeps its scroll offset and its
 * expanded nodes, and the deep query below does not run again.
 *
 * Access is display-only here. `locked` decides whether a row shows a €3 badge
 * — nothing more. What a student may actually read is decided by RLS and, for
 * the Einheit page, by its own `userHasUnitAccess` check; this layout could be
 * wrong about every badge and nothing would leak.
 *
 * The 404: `getKursNavTree` returns null for an unpublished Kurs as much as for
 * an unknown id, because `kurse` gate on `published` in RLS. Admins pass both.
 */
export default async function KursLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ kursId: string }>
}) {
  const { kursId } = await params

  const [kurs, { isAdmin, entitledUnitIds, entitledKursIds }] = await Promise.all([
    getKursNavTree(kursId),
    getKursViewerAccess(),
  ])
  if (!kurs) notFound()

  // Two ways in: the Einheit was bought, or the Kurs it sits in was
  // (add_kurs_entitlements.sql). Which of the two is on offer is `sold_as`,
  // and the price badge follows it.
  const kursEntitled = entitledKursIds.has(kursId)
  const units = kurs.units.map((unit) => ({
    ...unit,
    locked: !isAdmin && !kursEntitled && !entitledUnitIds.has(unit.id),
  }))

  return (
    // Full-bleed: `-mx-4 sm:-mx-8` cancels the padding `<main>` puts on every
    // page, so the sidebar sits flush against the left edge of the viewport
    // rather than inside the page gutter. Nothing centres the shell — a
    // max-width here would put a strip of background to the left of the
    // sidebar on wide screens.
    //
    // THE MIN-HEIGHT BELONGS ON THE FLEX CONTAINER, not on a wrapper around it.
    // The sidebar fills the viewport because it is a stretched flex item, and a
    // flex item stretches to its CONTAINER's height — a min-height one level up
    // would leave the row as short as its content and strand the sidebar's
    // background halfway down the page.
    <div className="-mx-4 bg-[#fffdf8] sm:-mx-8">
      {/* Records the visit for the catalogue's „Recently viewed" list.
          Renders nothing. */}
      <RecentKursTracker kursId={kursId} />
      {/* The line under the navbar. STICKY, not the container's `border-t`:
          a border at the top of a scrolling box scrolls away with the box, and
          the navbar above is `sticky` — so the moment the line left the
          viewport the header floated over the content with no edge at all.
          `top-[66px]` is the navbar's height (Navbar.tsx), and z-40 keeps it
          above the content it separates but under the navbar itself. */}
      <div aria-hidden className="sticky top-[66px] z-40 h-px bg-gray-200" />
      {/* Wraps BOTH columns: clicking a Dokument in the tree scrolls to the
          copy the page already rendered, and the sidebar and the page are
          sibling route subtrees with no other way to reach each other. */}
      <DocumentRevealProvider>
        <div
          className="flex flex-col lg:flex-row"
          style={{ minHeight: 'calc(100svh - 66px)' }}
        >
          <KursSidebar
            kursId={kursId}
            kursTitle={kurs.title}
            kursType={kurs.kurs_type}
            units={units}
            lockedPriceLabel={purchasePriceLabel(kurs.sold_as, kurs.price_cents)}
          />
          <div className="min-w-0 flex-1 px-5 py-8 sm:px-8 lg:px-12 lg:py-10">{children}</div>
        </div>
      </DocumentRevealProvider>
    </div>
  )
}
