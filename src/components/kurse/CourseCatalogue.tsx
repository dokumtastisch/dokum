'use client'

import Link from 'next/link'
import { ArrowRight, BookOpen, Clock3, FileText, GraduationCap } from 'lucide-react'
import { FilterLink, useKursFilter } from '@/components/kurse/catalog-filter'
import type { KursType, KursWithUnits } from '@/types'

export function CourseCatalogue({
  kurse,
  recentKurse,
}: {
  kurse: KursWithUnits[]
  recentKurse: KursWithUnits[]
}) {
  const filter = useKursFilter()
  const musterloesungen = kurse.filter((kurs) => kurs.kurs_type === 'musterloesung')
  const lernkurse = kurse.filter((kurs) => kurs.kurs_type === 'lernkurs')
  const visibleKurse = filter === 'all' ? kurse : kurse.filter((kurs) => kurs.kurs_type === filter)

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <CategoryCard
          active={filter === 'musterloesung'}
          href="/kurse?typ=musterloesung"
          icon={<FileText className="h-7 w-7" strokeWidth={1.8} />}
          label="Model Solutions"
          summary={summary(musterloesungen)}
          tone="red"
        />
        <CategoryCard
          active={filter === 'lernkurs'}
          href="/kurse?typ=lernkurs"
          icon={<GraduationCap className="h-8 w-8" strokeWidth={1.8} />}
          label="Learning Courses"
          summary={summary(lernkurse)}
          tone="slate"
        />
      </div>

      <div className="mt-5 flex items-center justify-between gap-4 border-b border-gray-200 pb-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-gray-800">
          <BookOpen className="h-[18px] w-[18px] text-gray-500" strokeWidth={2} />
          All Courses
        </h2>
      </div>

      {visibleKurse.length === 0 ? (
        <div className="mt-3 rounded-xl border border-gray-200 bg-white p-8 text-sm font-medium text-gray-500">
          No courses available.
        </div>
      ) : (
        <ul className="overflow-hidden">
          {visibleKurse.map((kurs) => (
            <KursRow key={kurs.id} kurs={kurs} />
          ))}
        </ul>
      )}

      {/* The section is its own list and NOT filtered by the category switch:
          what a student opened last is a fact about them, not about the
          category they happen to be browsing. It disappears entirely when the
          cookie is empty rather than showing an empty-state row. */}
      {recentKurse.length > 0 && (
        <>
          <div className="mt-10 flex items-center justify-between gap-4 border-b border-gray-200 pb-2">
            <h2 className="flex items-center gap-2 text-sm font-bold text-gray-800">
              <Clock3 className="h-[18px] w-[18px] text-gray-500" strokeWidth={2} />
              Recently viewed
            </h2>
          </div>

          <ul className="overflow-hidden">
            {recentKurse.map((kurs) => (
              <KursRow key={kurs.id} kurs={kurs} />
            ))}
          </ul>
        </>
      )}
    </>
  )
}

function KursRow({ kurs }: { kurs: KursWithUnits }) {
  return (
    <li className="border-b border-gray-100 last:border-b-0">
      <Link
        href={`/kurse/${kurs.id}`}
        className="group flex items-center gap-3 py-3 transition-colors hover:bg-white"
      >
        <BookOpen className="h-[18px] w-[18px] shrink-0 text-gray-600" strokeWidth={1.8} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-2.5">
            <span className="truncate text-sm font-bold text-gray-900 group-hover:text-brand">{kurs.title}</span>
            <CourseTypeBadge type={kurs.kurs_type} />
          </span>
        </span>
        {/* A Lernkurs counts only its Units: what it holds are Lernseiten, and
            the Mini Cases a Musterlösung is measured in are beside the point
            there — the number was mostly 0 and read as an empty course. */}
        <span className="hidden shrink-0 whitespace-nowrap text-xs font-medium text-gray-500 sm:block">
          {kurs.units.length} {kurs.units.length === 1 ? 'Unit' : 'Units'}
          {kurs.kurs_type === 'musterloesung' && ` · ${miniCaseCount(kurs)} Mini Cases`}
        </span>
        <ArrowRight className="h-4 w-4 shrink-0 text-gray-400 transition-transform group-hover:translate-x-1 group-hover:text-brand" strokeWidth={2.2} />
      </Link>
    </li>
  )
}

function CategoryCard({
  active,
  href,
  icon,
  label,
  summary,
  tone,
}: {
  active: boolean
  href: string
  icon: React.ReactNode
  label: string
  summary: string
  tone: 'red' | 'slate'
}) {
  const isRed = tone === 'red'
  return (
    <FilterLink
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`group flex min-h-20 items-center gap-4 rounded-lg border p-5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
        isRed
          ? 'border-red-100 bg-[#fff4f1] text-[#c93629] hover:border-red-200'
          : 'border-slate-100 bg-[#f5f8fc] text-slate-700 hover:border-slate-200'
      } ${active ? `ring-2 ring-offset-2 ${isRed ? 'ring-brand/30' : 'ring-blue-500/30'}` : ''}`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-bold text-gray-900">{label}</span>
        <span className="mt-1 block text-sm text-gray-500">{summary}</span>
      </span>
      <ArrowRight className="h-[18px] w-[18px] shrink-0 transition-transform duration-200 group-hover:translate-x-1" strokeWidth={2.2} />
    </FilterLink>
  )
}

function CourseTypeBadge({ type }: { type: KursType }) {
  const isMusterloesung = type === 'musterloesung'
  return (
    <span className={`rounded-md px-2 py-1 text-[10px] font-semibold ${isMusterloesung ? 'bg-red-50 text-brand' : 'bg-slate-100 text-slate-600'}`}>
      {isMusterloesung ? 'Model Solution' : 'Learning Course'}
    </span>
  )
}

function summary(kurse: KursWithUnits[]) {
  const miniCases = kurse.reduce((total, kurs) => total + miniCaseCount(kurs), 0)
  return `${kurse.length} ${kurse.length === 1 ? 'Course' : 'Courses'} · ${miniCases} Mini Cases`
}

function miniCaseCount(kurs: KursWithUnits) {
  return kurs.units.reduce(
    (unitTotal, unit) => unitTotal + unit.tasks.reduce((taskTotal, task) => taskTotal + task.documents.length, 0),
    0,
  )
}
