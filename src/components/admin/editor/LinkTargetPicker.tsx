'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { listLinkTargetDocuments } from '@/actions/admin'
import {
  LINK_ANCHOR_ICON,
  LINK_KIND_ICON,
  LINK_KIND_LABEL,
  linkTargetKind,
  sameLinkTarget,
  type DocumentLink,
  type LinkPickRequest,
  type LinkPickResult,
  type LinkTarget,
} from '@/lib/editor/links'
import type { EditorTargetKurs, LinkTargetDocument } from '@/types'

/**
 * The link target picker (#72, spec #63 §6) — the React half of the editor's
 * „🔗 Link" button.
 *
 * ONLY PUBLISHED TARGETS ARE OFFERED, and that single rule is what collapses
 * the whole linking design to a primary-key lookup: an author must publish the
 * target before linking to it, so following a link is a single-row fetch
 * instead of a search. The accepted cost is that authoring becomes
 * order-dependent, which is why the empty state says so out loud rather than
 * showing an unexplained blank tree.
 *
 * A tree and not an inline `@`-trigger: intercepting keystrokes inside a
 * contenteditable that already handles variable pills, drag-and-drop and
 * formula blocks is where editor bugs come from (decision #59).
 *
 * THE DOCUMENT LEVEL IS FETCHED PER AUFGABE, ON EXPAND. The Kurs → Einheit →
 * Aufgabe tree arrives with the page; going one level deeper eagerly would ship
 * every document id — and every published snapshot behind the Sprungmarken —
 * into the client bundle, which is exactly what `getEditorTargetTree` was
 * written to avoid.
 */

/** A chosen target plus the human path to it, for the confirmation line. */
interface Choice {
  target: LinkTarget
  /** The target's own name — the label fallback when nothing was selected. */
  name: string
  /** „Kurs › Einheit › Aufgabe › Dokument" — shown so the author can verify. */
  path: string
}

type DocumentsState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; documents: LinkTargetDocument[] }

export function LinkTargetPicker({
  request,
  targetTree,
  onClose,
}: {
  request: LinkPickRequest
  /** The full editor target tree; only its published Kurse are offered. */
  targetTree: EditorTargetKurs[]
  onClose: (result: LinkPickResult | null) => void
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)

  // Seeded once from the request: the author's selected text, or the label of
  // the link being edited. Only when BOTH are absent does choosing a target
  // fill the label with the target's own name.
  const [initialLabel] = useState(request.current?.label ?? request.selectedText)
  const [label, setLabel] = useState(initialLabel)
  const [labelEdited, setLabelEdited] = useState(false)
  // An existing link starts out already pointing where it points, so RELABELLING
  // is one edit. Seeding this null instead would force the author to walk the
  // tree back down to the target just to fix a word — and where that target's
  // Kurs has since been unpublished, the tree cannot offer it at all, so the
  // link could only be deleted, never rewritten.
  const [choice, setChoice] = useState<Choice | null>(
    request.current ? currentChoice(request.current) : null
  )
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [documents, setDocuments] = useState<Record<string, DocumentsState>>({})

  const publishedKurse = targetTree.filter((k) => k.published)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function expandTask(taskId: string) {
    const opening = !expanded.has(taskId)
    toggle(taskId)
    if (!opening) return
    // Loaded once per open picker — a re-fetch on every expand would hit the
    // server for a tree the author is only browsing. A FAILED load is the
    // exception: keeping it would hide the Aufgabe's documents for the life of
    // the dialog over one transient error, so collapsing and reopening retries.
    const state = documents[taskId]
    if (state && state.status !== 'error') return
    setDocuments((prev) => ({ ...prev, [taskId]: { status: 'loading' } }))
    try {
      const result = await listLinkTargetDocuments(taskId)
      setDocuments((prev) => ({
        ...prev,
        [taskId]: result.ok
          ? { status: 'ready', documents: result.data }
          : { status: 'error', error: result.error },
      }))
    } catch {
      setDocuments((prev) => ({
        ...prev,
        [taskId]: { status: 'error', error: 'Ziele konnten nicht geladen werden.' },
      }))
    }
  }

  function choose(next: Choice) {
    setChoice(next)
    if (!labelEdited && !initialLabel) setLabel(next.name)
  }

  const trimmedLabel = label.trim()
  const canApply = choice !== null && trimmedLabel !== ''

  function apply() {
    if (!choice || trimmedLabel === '') return
    const link: DocumentLink = { target: choice.target, label: trimmedLabel }
    onClose({ action: 'apply', link })
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="linkPickerTitle"
      onCancel={(event) => {
        event.preventDefault()
        onClose(null)
      }}
      className="m-auto w-[92vw] max-w-2xl rounded-xl border-0 bg-white p-0 shadow-2xl backdrop:bg-black/40"
    >
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault()
          apply()
        }}
        className="flex max-h-[85vh] flex-col"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <h2 id="linkPickerTitle" className="text-base font-semibold text-gray-900">
            {request.current ? 'Link bearbeiten' : 'Link einfügen'}
          </h2>
          <button
            type="button"
            onClick={() => onClose(null)}
            aria-label="Schließen"
            className="rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-900"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="mb-2 text-xs text-gray-500">
            Nur veröffentlichte Ziele können verlinkt werden — veröffentliche das Ziel zuerst.
          </p>

          {publishedKurse.length === 0 ? (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Es gibt noch keine veröffentlichten Kurse. Sobald ein Kurs veröffentlicht ist, kann
              darauf verlinkt werden.
            </p>
          ) : (
            <ul className="text-sm">
              {publishedKurse.map((kurs) => (
                <li key={kurs.id}>
                  <Row
                    depth={0}
                    expandable
                    expanded={expanded.has(kurs.id)}
                    onToggle={() => toggle(kurs.id)}
                    icon={LINK_KIND_ICON.kurs}
                    title={kurs.title}
                    selected={isSelected(choice, { kursId: kurs.id })}
                    onSelect={() =>
                      choose({ target: { kursId: kurs.id }, name: kurs.title, path: kurs.title })
                    }
                  />
                  {expanded.has(kurs.id) && (
                    <ul>
                      {kurs.units.length === 0 && <Empty depth={1}>Keine Einheiten.</Empty>}
                      {kurs.units.map((unit) => (
                        <li key={unit.id}>
                          <Row
                            depth={1}
                            expandable
                            expanded={expanded.has(unit.id)}
                            onToggle={() => toggle(unit.id)}
                            icon={LINK_KIND_ICON.unit}
                            title={unit.title}
                            selected={isSelected(choice, { unitId: unit.id })}
                            onSelect={() =>
                              choose({
                                target: { unitId: unit.id },
                                name: unit.title,
                                path: `${kurs.title} › ${unit.title}`,
                              })
                            }
                          />
                          {expanded.has(unit.id) && (
                            <ul>
                              {unit.tasks.length === 0 && <Empty depth={2}>Keine Aufgaben.</Empty>}
                              {unit.tasks.map((task) => {
                                const state = documents[task.id]
                                return (
                                  <li key={task.id}>
                                    {/* Eine Aufgabe ist kein Linkziel (spec §6) —
                                        sie lässt sich nur aufklappen. */}
                                    <Row
                                      depth={2}
                                      expandable
                                      expanded={expanded.has(task.id)}
                                      onToggle={() => void expandTask(task.id)}
                                      icon="🗂"
                                      title={task.title}
                                    />
                                    {expanded.has(task.id) && (
                                      <ul>
                                        {state?.status === 'loading' && (
                                          <Empty depth={3}>Wird geladen …</Empty>
                                        )}
                                        {state?.status === 'error' && (
                                          <Empty depth={3} tone="error">
                                            {state.error}
                                          </Empty>
                                        )}
                                        {state?.status === 'ready' &&
                                          state.documents.length === 0 && (
                                            <Empty depth={3}>Keine Dokumente.</Empty>
                                          )}
                                        {state?.status === 'ready' &&
                                          state.documents.map((doc) => (
                                            <li key={doc.id}>
                                              <Row
                                                depth={3}
                                                icon={LINK_KIND_ICON.document}
                                                title={doc.title}
                                                selected={isSelected(choice, { docId: doc.id })}
                                                onSelect={() =>
                                                  choose({
                                                    target: { docId: doc.id },
                                                    name: doc.title,
                                                    path: `${kurs.title} › ${unit.title} › ${task.title} › ${doc.title}`,
                                                  })
                                                }
                                              />
                                              <ul>
                                                {doc.anchors.map((anchor) => (
                                                  <li key={anchor.id}>
                                                    <Row
                                                      depth={4}
                                                      icon={LINK_ANCHOR_ICON}
                                                      title={anchor.label || 'Unbenannte Sprungmarke'}
                                                      selected={isSelected(choice, {
                                                        docId: doc.id,
                                                        anchorId: anchor.id,
                                                      })}
                                                      onSelect={() =>
                                                        choose({
                                                          target: {
                                                            docId: doc.id,
                                                            anchorId: anchor.id,
                                                          },
                                                          name: anchor.label || doc.title,
                                                          path: `${kurs.title} › ${unit.title} › ${task.title} › ${doc.title} › ${anchor.label || 'Sprungmarke'}`,
                                                        })
                                                      }
                                                    />
                                                  </li>
                                                ))}
                                              </ul>
                                            </li>
                                          ))}
                                      </ul>
                                    )}
                                  </li>
                                )
                              })}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-gray-200 px-5 py-4">
          <label htmlFor="linkLabel" className="block text-sm text-gray-600">
            Beschriftung
          </label>
          <input
            id="linkLabel"
            type="text"
            value={label}
            maxLength={200}
            onChange={(event) => {
              setLabel(event.target.value)
              setLabelEdited(true)
            }}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-brand focus:outline-none"
          />
          <p className="mt-2 min-h-[1.25rem] text-xs text-gray-500">
            {choice ? `Ziel: ${choice.path}` : 'Noch kein Ziel gewählt.'}
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-gray-200 px-5 py-3">
          <div>
            {request.current && (
              <button
                type="button"
                onClick={() => onClose({ action: 'remove' })}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
              >
                Link entfernen
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => onClose(null)}
              className="rounded-md px-4 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={!canApply}
              className="rounded-md bg-brand px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
            >
              {request.current ? 'Übernehmen' : 'Einfügen'}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  )
}

/**
 * What the picker starts on when an EXISTING link is being edited: where it
 * already points.
 *
 * The tree cannot describe that target yet — a document's level is not fetched
 * until its Aufgabe is expanded, and the target may sit under a Kurs that is no
 * longer published — so the path names the kind rather than the route to it.
 * Choosing anything in the tree replaces this wholesale.
 */
function currentChoice(current: DocumentLink): Choice {
  const kind = LINK_KIND_LABEL[linkTargetKind(current.target)]
  return {
    target: current.target,
    name: current.label,
    path: `bisheriges Ziel (${kind})`,
  }
}

/** Whether `choice` already points at exactly this target. */
function isSelected(choice: Choice | null, target: LinkTarget): boolean {
  return choice !== null && sameLinkTarget(choice.target, target)
}

const INDENT = ['pl-2', 'pl-6', 'pl-10', 'pl-14', 'pl-[4.5rem]'] as const

/**
 * One tree row. A row with `onSelect` is a link target; a row without one —
 * an Aufgabe — only groups what is under it.
 */
function Row({
  depth,
  icon,
  title,
  expandable = false,
  expanded = false,
  onToggle,
  selected = false,
  onSelect,
}: {
  depth: number
  icon: string
  title: string
  expandable?: boolean
  expanded?: boolean
  onToggle?: () => void
  selected?: boolean
  onSelect?: () => void
}) {
  return (
    <div
      className={`flex items-center gap-1 rounded-md py-0.5 ${INDENT[depth] ?? INDENT[4]} ${
        selected ? 'bg-brand/10' : ''
      }`}
    >
      {expandable ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={expanded ? `${title} zuklappen` : `${title} aufklappen`}
          className="w-5 shrink-0 rounded text-xs text-gray-500 hover:bg-gray-100"
        >
          {expanded ? '▾' : '▸'}
        </button>
      ) : (
        <span className="w-5 shrink-0" />
      )}
      <span aria-hidden className="shrink-0">
        {icon}
      </span>
      {onSelect ? (
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={selected}
          className={`flex-1 truncate rounded px-1 py-0.5 text-left hover:bg-gray-100 ${
            selected ? 'font-semibold text-brand-dark' : 'text-gray-800'
          }`}
        >
          {title}
        </button>
      ) : (
        <span className="flex-1 truncate px-1 py-0.5 text-gray-500">{title}</span>
      )}
    </div>
  )
}

function Empty({
  depth,
  tone = 'muted',
  children,
}: {
  depth: number
  tone?: 'muted' | 'error'
  children: ReactNode
}) {
  return (
    <li
      className={`${INDENT[depth] ?? INDENT[4]} py-0.5 text-xs ${
        tone === 'error' ? 'text-red-700' : 'text-gray-400'
      }`}
    >
      {children}
    </li>
  )
}
