'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Lock } from 'lucide-react'
import { usePathname } from 'next/navigation'
import type { KursNavDocument, KursNavTask, KursNavUnit, KursType } from '@/types'
import { useRevealDocument } from '@/components/kurse/document-reveal'
import { ANCHOR_SCROLL_OFFSET, documentAnchorId } from '@/lib/document-anchor'
import { UNIT_PRICE_DISPLAY } from '@/lib/constants'
import {
  formatLessonNumber,
  lessonNumberPath,
  unitNumberPath,
} from '@/lib/lessons/lesson-meta'

/** One Einheit in the tree, plus the reader-specific lock state the layout decided. */
export type KursSidebarUnit = KursNavUnit & { locked: boolean }

interface Props {
  kursId: string
  kursTitle: string
  /** Only a Lernkurs numbers its Einheiten — see `unitNumberPath`. */
  kursType: KursType
  units: KursSidebarUnit[]
  /**
   * What a locked Einheit costs to open — the flat Einheitenpreis, or the whole
   * Kurs's price where the Kurs is sold entire (`purchasePriceLabel`).
   *
   * Optional because the editor's preview has no locked rows to put it on.
   */
  lockedPriceLabel?: string
  /** Forces the active branch for the editor's student-view preview. */
  activeUnitId?: string
  /** Highlights the page being edited without exposing its hidden carrier Task. */
  activeLessonId?: string
}

/**
 * The Kurs navigation tree (#106) — the sidebar that replaced the grid of Unit
 * cards on the Kurs page.
 *
 * It is mounted by the Kurs LAYOUT, which is the whole point: the tree stays
 * mounted while the student moves between Einheiten, so its scroll position
 * survives navigation for free.
 *
 * WHAT IS UNFOLDED IS THE ROUTE, NOT A STATE. There are no disclosure
 * triangles, so there is no gesture that could open a branch the student is not
 * in — and a tree that can only be opened by going somewhere has nothing left
 * to remember. The Einheit being read shows its full contents; every other one
 * is a single row. Clicking a row navigates, and unfolding is what arriving
 * looks like.
 *
 * Both routes it highlights are read off `usePathname()`:
 *   /kurse/[kursId]/units/[unitId]  → an Einheit
 *   /dokumente/[docId]              → a Dokument, which under this layout is
 *                                     the OVERLAY (#70). The page below is
 *                                     still mounted and so is this sidebar, so
 *                                     the open document shows as active with no
 *                                     state of our own.
 *
 * A locked Einheit has no `tasks` — RLS never handed them over — so it renders
 * as a leaf with a price badge and still links to its own page, which is where
 * the paywall lives.
 */
export function KursSidebar({
  kursId,
  kursTitle,
  kursType,
  units,
  lockedPriceLabel = UNIT_PRICE_DISPLAY,
  activeUnitId,
  activeLessonId,
}: Props) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  const routeUnitId = activeUnitId ?? matchSegment(pathname, `/kurse/${kursId}/units/`)
  const activeDocId = activeUnitId ? null : matchSegment(pathname, '/dokumente/')

  // Which branch the student is standing in — the Einheit of the route, or,
  // while a Dokument overlay is open, the Einheit that Dokument belongs to. The
  // overlay is a centred dialog on desktop, so the tree stays visible behind it
  // and has to keep pointing at what is on screen. Only `routeUnitId` gets the
  // highlight; the Einheit merely stays UNFOLDED, so the highlighted row is the
  // open Dokument itself rather than two rows competing.
  const branchUnitId =
    (activeDocId
      ? units.find((u) => u.tasks.some((t) => t.documents.some((d) => d.id === activeDocId)))?.id
      : null) ?? routeUnitId

  // The one thing in this tree that IS a state: an Aufgabe's Dokumente are
  // folded away until the Aufgabe is clicked. Einheiten still unfold purely
  // from the route — only this level has a control to press.
  //
  // The override is layered over a derived default rather than replacing it, so
  // an Aufgabe whose Dokument is open in the overlay is unfolded without anyone
  // having clicked it — otherwise the highlighted row would be hidden inside a
  // collapsed branch. Once the student presses it, their decision wins.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const holdsActiveDoc = (task: { documents: { id: string }[] }) =>
    task.documents.some((d) => d.id === activeDocId)

  // Which Lernseite the reader is currently inside. The Einheit's pages are all
  // on one scrolling page, so „where am I" is a question only the scroll
  // position can answer — the URL does not change as it goes by.
  //
  // The editor's preview passes `activeLessonId` and gets no scroll spy: there
  // the highlight means „this is the page you are editing", which must not
  // wander as the preview is scrolled.
  const spiedLessonIds = useMemo(() => {
    if (activeLessonId) return []
    const unit = units.find((u) => u.id === branchUnitId)
    return unit ? splitSidebarContents(unit.tasks).lessons.map((lesson) => lesson.id) : []
  }, [units, branchUnitId, activeLessonId])
  const lessonInView = useLessonInView(spiedLessonIds)
  const highlightedLessonId = activeLessonId ?? lessonInView

  return (
    // PINNED, AND `lg:self-start` IS WHAT MAKES THAT POSSIBLE. As a normal flex
    // item this element is stretched to the row's height by `align-items:
    // stretch`, which leaves `position: sticky` nothing to do — the box already
    // spans everything it could travel through. `self-start` hands the height
    // back, `h-[calc(100svh-66px)]` claims exactly the viewport below the
    // navbar, and the panel then stays put while the page scrolls past it.
    //
    // The 66px is the navbar's height (see Navbar.tsx, which is `sticky top-0`
    // at that height) — the two numbers must agree or the panel tucks under it.
    //
    // All of it is `lg:`-only. Below that the tree is a collapsible block above
    // the content and must scroll away with the page like any other block.
    <aside className="shrink-0 border-b border-gray-200 bg-[#faf8f3] lg:sticky lg:top-[66px] lg:h-[calc(100svh-66px)] lg:w-72 lg:self-start lg:overflow-y-auto lg:border-r lg:border-b-0">
      <div className="px-5 py-5 lg:px-6 lg:py-7">
        {/* The named way back to the catalogue. The navbar is no help here — it
            has no „Kurse" entry — so until now the Kurs title carried the link
            on its own, which nothing announced. The title stays a link so the
            old gesture keeps working; this is the one that can be seen. */}
        <Link
          href="/kurse"
          onClick={activeUnitId ? (event) => event.preventDefault() : undefined}
          className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 transition-colors hover:text-brand"
        >
          <ArrowLeft className="h-3.5 w-3.5 shrink-0" strokeWidth={2.4} />
          Back to courses
        </Link>
        <div className="flex items-start justify-between gap-3">
          <Link
            href="/kurse"
            onClick={activeUnitId ? (event) => event.preventDefault() : undefined}
            className="min-w-0 text-lg leading-tight font-black text-black transition-colors hover:text-brand"
          >
            {kursTitle}
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-expanded={mobileOpen}
            className="shrink-0 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-600 transition-colors hover:bg-white lg:hidden"
          >
            {mobileOpen ? 'Hide contents' : 'Contents'}
          </button>
        </div>
      </div>

      <nav
        aria-label="Course content"
        className={`px-3 pb-6 lg:block lg:px-4 ${mobileOpen ? 'block' : 'hidden'}`}
      >
        <ul className="space-y-0.5">
          {units.map((unit, unitIndex) => {
            const onBranch = unit.id === branchUnitId
            const { lessons, tasks } = splitSidebarContents(unit.tasks)
            // The same numbering the page prints, from the same functions: an
            // Einheit is numbered once it holds Lernseiten, and a page numbers
            // itself only from the second one on.
            const unitNumber = unitIndex + 1
            return (
              <li key={unit.id}>
                <Row
                  href={`/kurse/${kursId}/units/${unit.id}`}
                  number={formatLessonNumber(unitNumberPath(unitNumber, kursType === 'lernkurs'))}
                  label={unit.title}
                  level={0}
                  active={unit.id === routeUnitId && !activeDocId}
                  dot={unit.locked ? 'locked' : onBranch ? 'active' : 'unit'}
                  badge={unit.locked ? lockedPriceLabel : undefined}
                  preventNavigation={Boolean(activeUnitId)}
                />
                {onBranch && (lessons.length > 0 || tasks.length > 0) && (
                  <ul className="mt-0.5 ml-4 space-y-0.5 border-l border-gray-200 pl-2">
                    {lessons.map((lesson, lessonIndex) => (
                      <LessonRow
                        key={lesson.id}
                        lesson={lesson}
                        label={formatLessonNumber(
                          lessonNumberPath(unitNumber, lessonIndex, lessons.length)
                        )}
                        active={lesson.id === highlightedLessonId}
                        preview={Boolean(activeUnitId)}
                      />
                    ))}
                    {tasks.map((task) => (
                      <TaskBranch
                        key={task.id}
                        task={task}
                        activeDocId={activeDocId}
                        open={expanded[task.id] ?? holdsActiveDoc(task)}
                        onToggle={(next) =>
                          setExpanded((prev) => ({ ...prev, [task.id]: next }))
                        }
                      />
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
        {units.length === 0 && (
          <p className="px-3 py-2 text-xs text-gray-400">No units yet.</p>
        )}
      </nav>
    </aside>
  )
}

/**
 * Which of the rendered Lernseiten the reader is currently inside — the scroll
 * spy behind the sidebar's highlight.
 *
 * THE RULE IS „THE LAST HEADING I HAVE PASSED", not „the section nearest the
 * middle of the screen". A reader is inside the page whose heading they scrolled
 * past most recently, and that stays true while they read three screens of its
 * prose. Distance-based rules hand the highlight to the next section as soon as
 * it appears at the bottom edge, which reads as the tree guessing.
 *
 * Before the first heading has reached the line, the first page is the answer:
 * the top of the Einheit belongs to its first Lernseite, and highlighting
 * nothing there would look broken rather than neutral.
 *
 * Measured on scroll rather than with an IntersectionObserver because the
 * question is about ONE line on the screen, not about visibility: an observer
 * would need a rootMargin encoding that same line, plus threshold bookkeeping
 * to answer „which of the several visible ones". A rAF-throttled read of
 * `getBoundingClientRect()` says it directly.
 */
function useLessonInView(lessonIds: readonly string[]): string | null {
  const [active, setActive] = useState<string | null>(null)

  // The ids as one string: the array is rebuilt on every render, so depending
  // on its identity would restart the listener each time.
  const key = lessonIds.join(',')

  useEffect(() => {
    const ids = key ? key.split(',') : []
    if (ids.length === 0) return

    let frame = 0

    const measure = () => {
      frame = 0
      // Derived from where a jump parks a heading, plus a little slack: a
      // clicked page must still count as current once it has landed, and a
      // hand-picked number here would silently stop agreeing the day the offset
      // changes.
      const readingLine = ANCHOR_SCROLL_OFFSET + 24
      let current: string | null = null
      for (const id of ids) {
        const top = document.getElementById(documentAnchorId(id))?.getBoundingClientRect().top
        if (top !== undefined && top <= readingLine) current = id
      }
      setActive(current ?? ids[0])
    }

    // Scheduled rather than called: setState directly in an effect body is a
    // cascading render, and the first measurement can wait one frame.
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(measure)
    }

    schedule()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [key])

  return active
}

/**
 * Lernseiten are Documents only because the database requires that ancestry.
 * In the reader tree they are pages directly below their Unit; the carrier
 * Task must never become a visible extra level.
 */
export function splitSidebarContents(tasks: readonly KursNavTask[]) {
  const lessons: KursNavDocument[] = []
  const visibleTasks: KursNavTask[] = []

  for (const task of tasks) {
    const taskLessons = task.documents.filter((document) => document.file_type === 'lesson')
    const otherDocuments = task.documents.filter((document) => document.file_type !== 'lesson')
    lessons.push(...taskLessons)
    if (otherDocuments.length > 0 || taskLessons.length === 0) {
      visibleTasks.push({ ...task, documents: otherDocuments })
    }
  }

  return { lessons, tasks: visibleTasks }
}

function LessonRow({
  lesson,
  label,
  active,
  preview,
}: {
  lesson: KursNavDocument
  /** „1.2", or '' when the Einheit heading already carries this page's number. */
  label: string
  active: boolean
  preview: boolean
}) {
  return (
    <li>
      <button
        type="button"
        aria-current={active ? 'page' : undefined}
        onClick={() => {
          if (preview) return
          const heading = document.getElementById(documentAnchorId(lesson.id))
          if (!heading) return
          // Computed rather than `scrollIntoView({ block: 'start' })`: that
          // relies on `scroll-margin-top` reaching the element the browser
          // decides to align, and both of the previous attempts to make the
          // jump land on the heading failed inside that indirection. The
          // arithmetic here is the whole rule, visible in one line.
          window.scrollTo({
            top: heading.getBoundingClientRect().top + window.scrollY - ANCHOR_SCROLL_OFFSET,
            behavior: 'smooth',
          })
        }}
        className={`${rowClasses(active, 1)} w-full text-left`}
      >
        <Dot kind={active ? 'active' : 'branch'} />
        {label && <span className="shrink-0 tabular-nums text-gray-400">{label}</span>}
        <span className="min-w-0 flex-1 truncate">{lesson.title}</span>
      </button>
    </li>
  )
}

/**
 * One Aufgabe and its Dokumente — the only foldable level in the tree.
 *
 * Its row is a BUTTON, not a link: there is no Aufgabe route to navigate to,
 * and pressing it is the only gesture here that means „show me what is in
 * here". An Aufgabe with no Dokumente is disabled rather than hidden — it is
 * still part of the Einheit's shape and worth seeing.
 */
function TaskBranch({
  task,
  activeDocId,
  open,
  onToggle,
}: {
  task: KursNavTask
  activeDocId: string | null
  open: boolean
  onToggle: (next: boolean) => void
}) {
  const reveal = useRevealDocument()

  return (
    <li>
      <button
        type="button"
        onClick={() => onToggle(!open)}
        aria-expanded={open}
        disabled={task.documents.length === 0}
        className={`${rowClasses(false, 1)} w-full text-left disabled:cursor-default`}
      >
        <Dot kind="branch" />
        <span className="min-w-0 flex-1 truncate">{task.title}</span>
      </button>
      {open && task.documents.length > 0 && (
        <ul className="mt-0.5 ml-4 space-y-0.5 border-l border-gray-200 pl-2">
          {task.documents.map((doc) => (
            <li key={doc.id}>
              {/* NOT a link. The Dokument is already rendered in the main
                  column; this scrolls to it there instead of opening a second
                  copy. The overlay is still reachable — from „Einzelansicht ↗"
                  next to the Dokument itself. */}
              <button
                type="button"
                onClick={() => reveal(doc.id)}
                className={`${rowClasses(doc.id === activeDocId, 2)} w-full text-left`}
              >
                <Dot kind={doc.id === activeDocId ? 'active' : 'branch'} />
                <span className="min-w-0 flex-1 truncate">{doc.title}</span>
                {doc.file_type === 'pdf' && (
                  <span className="shrink-0 rounded bg-gray-200 px-1 text-[9px] font-bold tracking-wide text-gray-500">
                    PDF
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

/** One row of the tree — a link, and only a link. */
function Row({
  href,
  number,
  label,
  level,
  active,
  dot,
  badge,
  preventNavigation = false,
}: {
  href: string
  /** „1", or '' for an Einheit that carries no number (see lesson-meta.ts). */
  number?: string
  label: string
  level: 0 | 1
  active: boolean
  dot: DotKind
  badge?: string
  preventNavigation?: boolean
}) {
  // A locked Einheit reads as locked at a glance — a padlock where the dot
  // sits, and muted text. It stays a LINK: its page is the offer, and getting
  // there is the point of the row.
  const locked = dot === 'locked'
  return (
    <Link
      href={href}
      onClick={preventNavigation ? (event) => event.preventDefault() : undefined}
      className={rowClasses(active, level, locked)}
    >
      {locked ? (
        <Lock aria-hidden className="h-3 w-3 shrink-0" strokeWidth={2.2} />
      ) : (
        <Dot kind={dot} />
      )}
      {/* `opacity`, not a colour: the row is brand-coloured when active and
          grey when not, and the number has to follow it either way. */}
      {number && <span className="shrink-0 opacity-60 tabular-nums">{number}</span>}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge && (
        <span className="shrink-0 rounded-full bg-brand px-1.5 py-px text-[10px] font-bold text-white">
          {badge}
        </span>
      )}
    </Link>
  )
}

// `locked` is folded into the tone rather than appended by the caller: two
// `text-…` utilities on one element do not resolve by the order they are
// written in — whichever Tailwind emits last wins, which is not a decision
// anyone here gets to make. One tone, picked once.
function rowClasses(active: boolean, level: 0 | 1 | 2, locked = false): string {
  const weight = level === 0 ? 'font-bold' : 'font-medium'
  const size = level === 2 ? 'text-[13px]' : 'text-sm'
  const tone = active
    ? 'bg-brand/10 text-brand'
    : locked
      ? 'text-gray-400 hover:bg-black/[0.04] hover:text-gray-500'
      : 'text-gray-700 hover:bg-black/[0.04] hover:text-black'
  return `flex min-w-0 items-center gap-2 rounded-md py-1.5 pr-2 pl-2 ${size} ${weight} ${tone} transition-colors`
}

// No progress model exists in the schema, so these are the only four things a
// dot can honestly say: this is an Einheit, this is where you are, this is
// something below an Einheit, or this is locked.
type DotKind = 'unit' | 'active' | 'branch' | 'locked'

const DOT_CLASSES: Record<DotKind, string> = {
  unit: 'bg-brand',
  active: 'bg-brand',
  branch: 'bg-gray-300',
  locked: 'border border-gray-400 bg-transparent',
}

function Dot({ kind }: { kind: DotKind }) {
  return <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_CLASSES[kind]}`} />
}

/** The id in `/prefix/<id>`, or null when `pathname` is not under that prefix. */
function matchSegment(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null
  const rest = pathname.slice(prefix.length)
  if (!rest) return null
  const [id] = rest.split('/')
  return id || null
}
