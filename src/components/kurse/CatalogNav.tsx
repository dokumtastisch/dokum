'use client'

import { FilterLink, useKursFilter, type KursFilter } from '@/components/kurse/catalog-filter'

const CATEGORIES: ReadonlyArray<{
  value: KursFilter
  href: string
  label: string
  Icon: () => React.ReactElement
}> = [
  { value: 'all', href: '/kurse', label: 'Courses', Icon: BookIcon },
  { value: 'musterloesung', href: '/kurse?typ=musterloesung', label: 'Model Solutions', Icon: DocumentIcon },
  { value: 'lernkurs', href: '/kurse?typ=lernkurs', label: 'Learning Courses', Icon: CapIcon },
]

export function CatalogNav() {
  const filter = useKursFilter()

  return (
    <nav aria-label="Course categories" className="mt-8 flex flex-col gap-1">
      {CATEGORIES.map(({ value, href, label, Icon }) => (
        <FilterLink
          key={value}
          href={href}
          aria-current={filter === value ? 'page' : undefined}
          className={
            filter === value
              ? 'flex min-w-0 items-center gap-3 rounded-md border-l-2 border-brand bg-brand/5 px-3 py-2 text-sm font-semibold text-brand'
              : 'flex min-w-0 items-center gap-3 rounded-md border-l-2 border-transparent px-3 py-2 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800'
          }
        >
          <Icon />
          {/* `min-w-0` above plus `truncate` here is what keeps the label
              inside its own highlight. Without it a flex child refuses to
              shrink below its text width and simply runs past the row — which
              is exactly how the active „Musterlösungen" escaped its backdrop. */}
          <span className="truncate">{label}</span>
        </FilterLink>
      ))}
    </nav>
  )
}

function BookIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z" />
      <path d="M4 5.5v16A2.5 2.5 0 0 1 6.5 19H20" />
    </svg>
  )
}

function DocumentIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M7 3h7l4 4v14H7V3Z" />
      <path d="M14 3v5h5M9.5 12h6M9.5 16h6" />
    </svg>
  )
}

function CapIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="m3 9 9-5 9 5-9 5-9-5Z" />
      <path d="M7 12.2V16c2.4 2.1 7.6 2.1 10 0v-3.8M21 9v6" />
    </svg>
  )
}
