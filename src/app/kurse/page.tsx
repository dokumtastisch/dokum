import { cookies } from 'next/headers'
import Link from 'next/link'
import { getPublishedKurseDeep } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { CatalogNav } from '@/components/kurse/CatalogNav'
import { CourseCatalogue } from '@/components/kurse/CourseCatalogue'
import { NavbarActions } from '@/components/layout/NavbarActions'
import { RECENT_KURSE_COOKIE, parseRecentKursIds } from '@/lib/recent-kurse'

/**
 * The catalogue is a shell of its own: its logo and its actions sit where the
 * global navbar would, so `globals.css` hides that navbar against
 * `.course-catalog-shell` and the shell goes full bleed with the `-mx-4
 * sm:-mx-8` DESIGN.md prescribes for it.
 *
 * This page fetches every published Kurs once and hands the whole list to the
 * catalogue. Narrowing it to a category is then a browser-side question — see
 * `catalog-filter.tsx` for why that switch must not become a navigation.
 */
export default async function KursePage() {
  const supabase = await createClient()
  const [allKurse, { data: { user } }, cookieStore] = await Promise.all([
    getPublishedKurseDeep(),
    supabase.auth.getUser(),
    cookies(),
  ])

  const isAdmin = user?.app_metadata?.['role'] === 'admin'
  // Derived exactly as Navbar.tsx does it — the same person must not be called
  // two different things in two headers.
  const userName =
    user?.user_metadata?.['full_name'] ||
    user?.user_metadata?.['name'] ||
    user?.email?.split('@')[0] ||
    null

  // „Recently viewed" resolves against the list that was just fetched, so a Kurs
  // that has since been unpublished or deleted simply is not found and drops
  // out — no second query, and nothing to clean up in the cookie.
  const byId = new Map(allKurse.map((kurs) => [kurs.id, kurs]))
  const recentKurse = parseRecentKursIds(cookieStore.get(RECENT_KURSE_COOKIE)?.value)
    .map((id) => byId.get(id))
    .filter((kurs) => kurs !== undefined)

  return (
    <div className="course-catalog-shell -mx-4 bg-[#fffefa] text-black sm:-mx-8">
      {/* The min-height belongs on the grid, not on a wrapper: the sidebar
          fills the viewport because it is a stretched grid item, and an item
          stretches to its CONTAINER's height. */}
      {/* 200px, not 180: „Musterlösungen" in its active weight (font-semibold,
          wider than the inactive one) needs 150px of row and had 145 — the
          label ran out of its own highlight. This leaves ~15px of headroom;
          the row itself truncates rather than spilling if a longer label ever
          turns up. */}
      <div className="relative grid min-h-svh grid-cols-1 sm:grid-cols-[200px_minmax(0,1fr)]">
        {/* THE navbar's actions, not a copy of them. This shell hides the
            global navbar (globals.css), and the hand-built „Account" link that
            stood here was a dead end: it showed a word instead of the reader's
            name and went straight to /settings, with no way to log out.

            ANCHORED TO THE GRID, NOT TO <main>. Below `sm` the grid is a single
            column, so the sidebar stacks ON TOP of the content — and a box
            pinned to the top-right of `<main>` landed underneath the category
            list instead of in the header. The grid spans both, so „top right of
            the page" means the same thing in one column as in two. */}
        <div className="absolute right-7 top-4 z-10">
          <NavbarActions isAdmin={isAdmin} userName={userName} />
        </div>

        <aside className="border-r border-[#eceae5] px-4 py-4">
          {/* 20px from the left edge, 16px down — the position the global
              navbar's logo also holds, because that one is flush left too
              (Navbar.tsx). Both have to agree or the logo jumps as you move
              between the catalogue and a Kurs. */}
          <Link href="/" className="flex items-center gap-2 px-1 text-lg font-black uppercase tracking-tight text-gray-950">
            <span className="flex h-7 w-7 items-center justify-center rounded bg-brand text-xl font-black text-white shadow-[inset_0_1px_0_rgb(255_255_255_/_0.25)]">D</span>
            DOKUM
          </Link>

          <CatalogNav />
        </aside>

        <main className="px-7 py-14">
          {/* 1420px is the cap the footer uses, so the catalogue stops growing
              at the same width the rest of the app does. */}
          <section className="max-w-[1420px]">
            <h1 className="text-2xl font-bold tracking-tight text-gray-950">Courses</h1>
            <p className="mt-1 text-xs leading-relaxed text-gray-500">
              Everything in one place. Pick a category or browse all courses.
            </p>

            <div className="mt-4">
              <CourseCatalogue kurse={allKurse} recentKurse={recentKurse} />
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}
