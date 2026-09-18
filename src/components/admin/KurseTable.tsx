'use client'

import { useEffect, useLayoutEffect, useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { deleteKurs } from '@/actions/admin'
import type { Kurs } from '@/types'
import { AdminModal } from './AdminModal'
import { KursForm } from './KursForm'

/** A Kurs as the table lists it: its own row plus the Einheiten it has to count. */
export type KursRow = Pick<
  Kurs,
  'id' | 'title' | 'description' | 'position' | 'published' | 'kurs_type' | 'sold_as'
> & {
  units: { id: string }[]
  /** Already formatted — the raw timestamp never reaches the browser (format-date.ts). */
  createdLabel: string
}

/**
 * „Kurse verwalten" (#108): a table of what exists, and one button that opens
 * the create form over it. Editing has its own course-wide workspace.
 *
 * The previous page put a create form permanently on the left and a tree on
 * the right, which meant the first thing an admin saw was an empty form rather
 * than their catalogue. The table is now the page; creating and editing are
 * both interruptions of it.
 *
 * The separate edit route owns the complete hierarchy (Units, Aufgaben and
 * Dokumente); keeping it out of this table prevents the catalogue from turning
 * into a second, competing editor.
 */
export function KurseTable({ kurse }: { kurse: KursRow[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [editing, setEditing] = useState<'new' | null>(null)

  /**
   * Opens a Kurs from a click anywhere in its row.
   *
   * A drag that ends up selecting the title is NOT a click on the row. Without
   * this guard, highlighting a course name to copy it navigates away the moment
   * the mouse is released — the single most annoying failure mode of clickable
   * rows.
   */
  function openKurs(kursId: string) {
    if (window.getSelection()?.toString()) return
    router.push(`/admin/kurse/${kursId}`)
  }
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function remove(kurs: KursRow) {
    const confirmed = window.confirm(
      `Kurs "${kurs.title}" und alle zugehörigen Units, Tasks und Dokumente wirklich löschen?`
    )
    if (!confirmed) return
    startTransition(async () => {
      const result = await deleteKurs(kurs.id)
      if (result.ok) router.refresh()
      else setError(result.error)
    })
  }

  return (
    <>
      <div className="mb-5 flex items-center justify-between gap-4">
        <p className="text-sm font-medium text-gray-500">
          {kurse.length} {kurse.length === 1 ? 'Kurs' : 'Kurse'}
        </p>
        <div className="flex items-center gap-3">
          {/* The only way into the standalone LaTeX editor now that the admin
              subpage tab row is gone from this page. Neutral form (DESIGN.md),
              sized to match the primary button beside it. */}
          <Link
            href="/admin/editor"
            className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
          >
            Alter Editor
          </Link>
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="btn-brand rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm"
          >
            + Neuen Kurs hinzufügen
          </button>
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-[0_10px_35px_rgba(15,23,42,0.06)]">
        <table className="w-full min-w-[46rem] border-collapse text-sm">
          <thead className="bg-gray-50/80">
            <tr className="border-b border-gray-200 text-left">
              <Th>Kursname</Th>
              <Th>Einheiten</Th>
              <Th>Art</Th>
              <Th>Status</Th>
              <Th>Erstellt</Th>
              <Th className="text-center">Aktion</Th>
            </tr>
          </thead>
          <tbody>
            {kurse.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-sm text-gray-400">
                  Noch keine Kurse. Leg oben den ersten an.
                </td>
              </tr>
            )}
            {kurse.map((kurs) => (
              /* THE WHOLE ROW OPENS THE COURSE, but the title is still a real
                 <Link>. The row's onClick is the convenient target; the link is
                 what makes the row reachable by keyboard, openable in a new tab
                 and understandable to a screen reader. A row that only had
                 onClick would be none of those. */
              <tr
                key={kurs.id}
                onClick={() => openKurs(kurs.id)}
                className="cursor-pointer border-b border-gray-100 transition-colors last:border-b-0 hover:bg-gray-100"
              >
                <td className="px-6 py-4">
                  <div className="min-w-0">
                    <Link
                      href={`/admin/kurse/${kurs.id}`}
                      // The row already navigates; without this the click would
                      // be handled twice.
                      onClick={(event) => event.stopPropagation()}
                      // Deliberately styled exactly like the plain title it
                      // replaced — it is a link so the row is keyboard- and
                      // new-tab-reachable, not to look like one.
                      className="truncate font-semibold text-gray-900"
                    >
                      {kurs.title}
                    </Link>
                    {kurs.description && (
                      <p className="mt-0.5 max-w-sm truncate text-xs text-gray-400">
                        {kurs.description}
                      </p>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 text-gray-500">
                  {kurs.units.length} {kurs.units.length === 1 ? 'Einheit' : 'Einheiten'}
                </td>
                <td className="px-6 py-4 text-gray-500">
                  {kurs.kurs_type === 'lernkurs' ? 'Lernkurs' : 'Musterlösungen'}
                </td>
                <td className="px-6 py-4">
                  <StatusBadge published={kurs.published} />
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-gray-500 tabular-nums">
                  {kurs.createdLabel}
                </td>
                {/* The menu lives inside a row that navigates — every click
                    in here has to stay in here. */}
                <td className="px-6 py-4 text-center" onClick={(event) => event.stopPropagation()}>
                  <CourseActionsMenu
                    kurs={kurs}
                    open={openMenuId === kurs.id}
                    deletePending={pending}
                    onToggle={() => setOpenMenuId((current) => (current === kurs.id ? null : kurs.id))}
                    onClose={() => setOpenMenuId(null)}
                    onDelete={() => {
                      setOpenMenuId(null)
                      remove(kurs)
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <AdminModal
          title="Neuen Kurs hinzufügen"
          onClose={() => setEditing(null)}
        >
          <KursForm
            key="new"
            onSuccess={() => setEditing(null)}
          />
        </AdminModal>
      )}
    </>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={`px-6 py-4 text-[11px] font-semibold tracking-[0.07em] text-gray-400 uppercase ${className}`}
    >
      {children}
    </th>
  )
}

/**
 * „Veröffentlicht" vs. „Privat".
 *
 * `kurse.published` is the ONE flag the whole visibility model hangs from — it
 * gates the Kurs, its Einheiten, and every Aufgabe, Dokument and Datei beneath
 * them through RLS. „Privat" is therefore the honest word: the Kurs is not
 * merely hidden from a list, it is unreadable.
 */
function StatusBadge({ published }: { published: boolean }) {
  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-[11px] font-semibold ring-1 ring-inset ${
        published
          ? 'bg-emerald-100 text-emerald-800 ring-emerald-200'
          : 'bg-rose-100 text-rose-700 ring-rose-200'
      }`}
    >
      {published ? 'Veröffentlicht' : 'Privat'}
    </span>
  )
}

function CourseActionsMenu({
  kurs,
  open,
  deletePending,
  onToggle,
  onClose,
  onDelete,
}: {
  kurs: KursRow
  open: boolean
  deletePending: boolean
  onToggle: () => void
  onClose: () => void
  onDelete: () => void
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const menuId = `kurs-actions-${kurs.id}`

  useLayoutEffect(() => {
    if (!open) return

    function positionMenu() {
      const button = buttonRef.current
      if (!button) return

      const buttonRect = button.getBoundingClientRect()
      const menuWidth = menuRef.current?.offsetWidth ?? 192
      const menuHeight = menuRef.current?.offsetHeight ?? 132
      const gap = 8
      const viewportPadding = 12
      const spaceBelow = window.innerHeight - buttonRect.bottom
      const top =
        spaceBelow >= menuHeight + gap
          ? buttonRect.bottom + gap
          : Math.max(viewportPadding, buttonRect.top - menuHeight - gap)

      setPosition({
        top,
        left: Math.min(
          window.innerWidth - menuWidth - viewportPadding,
          Math.max(viewportPadding, buttonRect.right - menuWidth)
        ),
      })
    }

    positionMenu()
    window.addEventListener('resize', positionMenu)
    window.addEventListener('scroll', positionMenu, true)
    return () => {
      window.removeEventListener('resize', positionMenu)
      window.removeEventListener('scroll', positionMenu, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return

    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()

    function dismissOnOutsidePress(event: PointerEvent) {
      const target = event.target as Node
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return
      onClose()
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
      buttonRef.current?.focus()
    }

    document.addEventListener('pointerdown', dismissOnOutsidePress)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', dismissOnOutsidePress)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, onClose])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Aktionen für ${kurs.title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={onToggle}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 bg-white text-xl leading-none font-bold tracking-[0.08em] text-gray-400 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <span aria-hidden="true" className="-translate-y-0.5">
          ···
        </span>
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={`Aktionen für ${kurs.title}`}
            style={{ top: position.top, left: position.left }}
            className="fixed z-50 w-48 rounded-xl border border-gray-200 bg-white p-1.5 text-left shadow-[0_14px_35px_rgba(15,23,42,0.16)]"
            onKeyDown={(event) => {
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              const items = Array.from(
                event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')
              )
              if (items.length === 0) return
              const currentIndex = items.indexOf(document.activeElement as HTMLElement)
              const nextIndex =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? items.length - 1
                    : event.key === 'ArrowDown'
                      ? (currentIndex + 1) % items.length
                      : (currentIndex - 1 + items.length) % items.length
              items[nextIndex]?.focus()
            }}
          >
            <Link
              href={`/admin/kurse/${kurs.id}`}
              role="menuitem"
              onClick={onClose}
              className="flex w-full rounded-lg px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
            >
              Bearbeiten
            </Link>
            <Link
              href={`/admin/units/new?kursId=${kurs.id}`}
              role="menuitem"
              onClick={onClose}
              className="flex w-full rounded-lg px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
            >
              Einheiten verwalten
            </Link>
            <div className="my-1 border-t border-gray-100" />
            <button
              type="button"
              role="menuitem"
              disabled={deletePending}
              aria-disabled={deletePending}
              onClick={onDelete}
              className="flex w-full rounded-lg px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-gray-100 focus:bg-gray-100 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
            >
              Löschen
            </button>
          </div>,
          document.body
        )}
    </>
  )
}
