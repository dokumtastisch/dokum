import Link from 'next/link'

/**
 * The catalogue hides the global navbar through `body:has(.course-catalog-shell)`
 * — so this skeleton has to carry that class too, or the navbar flashes in for
 * the length of the fetch and is gone again once the page arrives.
 *
 * Everything that does not depend on the fetch (shell, sidebar chrome, logo) is
 * rendered for real; only what the Kurs list fills in is a pulsing block. The
 * sidebar nav is a placeholder rather than `<CatalogNav />` because the real one
 * reads the filter from the URL search params.
 */
export default function KurseLoading() {
  return (
    <div className="course-catalog-shell -mx-4 bg-[#fffefa] text-black sm:-mx-8">
      <div className="relative grid min-h-svh grid-cols-1 sm:grid-cols-[200px_minmax(0,1fr)]">
        {/* On the grid, like the real one: below `sm` the sidebar stacks above
            the content, and the account control belongs in the header either
            way. */}
        <div className="absolute right-7 top-4 flex items-center gap-5">
          <div className="h-8 w-28 rounded-md bg-gray-100 animate-pulse" />
        </div>

        <aside className="border-r border-[#eceae5] px-4 py-4">
          <Link href="/" className="flex items-center gap-2 px-1 text-lg font-black uppercase tracking-tight text-gray-950">
            <span className="flex h-7 w-7 items-center justify-center rounded bg-brand text-xl font-black text-white shadow-[inset_0_1px_0_rgb(255_255_255_/_0.25)]">D</span>
            DOKUM
          </Link>

          {/* The real nav reads the filter from the URL; here it is three bars. */}
          <div className="mt-8 flex flex-col gap-1">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-9 rounded-md bg-gray-100 animate-pulse" />
            ))}
          </div>
        </aside>

        <main className="px-7 py-14">
          <section className="max-w-[1420px]">
            <div className="h-8 w-40 rounded-md bg-gray-100 animate-pulse" />
            <div className="mt-2 h-3 w-72 max-w-full rounded bg-gray-100 animate-pulse" />

            <div className="mt-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="h-20 rounded-lg bg-gray-100 animate-pulse" />
                <div className="h-20 rounded-lg bg-gray-100 animate-pulse" />
              </div>

              <div className="mt-5 flex items-center justify-between gap-4 border-b border-gray-200 pb-2">
                <div className="h-4 w-28 rounded bg-gray-100 animate-pulse" />
              </div>

              {/* Only the „All Courses" list is skeletoned: whether a second,
                  „Recently viewed" list exists depends on a cookie this
                  boundary does not read. */}
              <ul className="overflow-hidden">
                {Array.from({ length: 5 }).map((_, i) => (
                  <li key={i} className="border-b border-gray-100 last:border-b-0">
                    <div className="flex items-center gap-3 py-3">
                      <div className="h-[18px] w-[18px] shrink-0 rounded bg-gray-100 animate-pulse" />
                      <div className="h-4 w-56 max-w-full rounded bg-gray-100 animate-pulse" />
                      <div className="ml-auto hidden h-3 w-40 rounded bg-gray-100 animate-pulse sm:block" />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}
