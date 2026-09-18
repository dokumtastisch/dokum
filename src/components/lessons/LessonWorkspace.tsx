'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createLesson } from '@/actions/admin'
import type { LessonWorkspaceKurs } from '@/lib/dal'
import { readLessonJson } from '@/lib/lessons/lesson-version'
import { emptyLessonJson, type LatestLessonJson } from '@/lib/lessons/lesson-json'
import { LessonEditor } from './LessonEditor'

/**
 * The Lernseiten workspace (#107) — tree on the left, page on the right.
 *
 * ONE PAGE IS OPEN AT A TIME. The shared LessonEditor owns its local draft, so
 * every keystroke stays in the browser and only an explicit „Speichern" writes
 * the page back. The same editor is embedded in the course workspace.
 *
 * ⚠ SAVING WRITES LIVE CONTENT. There is no draft layer yet: if the Kurs is
 * published, students see the save immediately. The course-wide draft mode is
 * the next piece of work, and until it exists this is stated in the UI rather
 * than left for an author to discover.
 *
 */
export function LessonWorkspace({
  tree,
  initialDocumentId,
}: {
  tree: LessonWorkspaceKurs[]
  initialDocumentId?: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [selected, setSelected] = useState<SelectedPage | null>(() =>
    findInitialSelection(tree, initialDocumentId)
  )
  const [status, setStatus] = useState<string | null>(null)

  /**
   * Opens a page from the tree. The stored JSON goes through the read boundary
   * rather than being cast: a page written by a newer build, or corrupted, must
   * refuse to open instead of being edited as a partial document and saved back
   * over the original.
   */
  function open(kurs: LessonWorkspaceKurs, unitId: string, page: { id: string; title: string; content: unknown }) {
    // An empty page has `content` from the action, but a row written before
    // that existed could still be null — treat both as a blank page.
    if (page.content == null) {
      setSelected({ id: page.id, kursId: kurs.id, unitId, title: page.title, lesson: emptyLessonJson() })
      setStatus(null)
      return
    }
    const result = readLessonJson(page.content)
    if (!result.ok) {
      setSelected(null)
      setStatus(result.error)
      return
    }
    setSelected({ id: page.id, kursId: kurs.id, unitId, title: page.title, lesson: result.lesson })
    setStatus(null)
  }

  function addLesson(unitId: string) {
    const title = window.prompt('Titel der Lernseite?')
    if (!title?.trim()) return
    const form = new FormData()
    form.set('unit_id', unitId)
    form.set('title', title.trim())
    startTransition(async () => {
      const result = await createLesson(form)
      setStatus(result.ok ? 'Lernseite angelegt.' : result.error)
      if (result.ok) router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <aside className="shrink-0 lg:w-64">
        <h2 className="mb-2 text-xs font-bold tracking-[0.1em] text-gray-400 uppercase">Kurse</h2>
        {tree.length === 0 && <p className="text-sm text-gray-400">Noch keine Kurse.</p>}
        <ul className="flex flex-col gap-4">
          {tree.map((kurs) => (
            <li key={kurs.id}>
              <p className="flex items-center gap-2 text-sm font-bold text-black">
                {kurs.title}
                <TypeBadge kurs={kurs} />
              </p>
              <ul className="mt-1 flex flex-col gap-1">
                {kurs.units.map((unit) => (
                  <li key={unit.id}>
                    <div className="flex items-center justify-between gap-1">
                      <span className="min-w-0 truncate text-sm text-gray-600">{unit.title}</span>
                      <button
                        type="button"
                        onClick={() => addLesson(unit.id)}
                        disabled={pending}
                        aria-label={`Lernseite in ${unit.title} anlegen`}
                        title="Lernseite anlegen"
                        className="shrink-0 rounded px-1.5 text-sm text-gray-400 hover:bg-gray-100 hover:text-brand disabled:opacity-40"
                      >
                        +
                      </button>
                    </div>
                    <ul className="ml-3 border-l border-gray-200 pl-2">
                      {unit.lessons.map((page) => (
                        <li key={page.id}>
                          <button
                            type="button"
                            onClick={() => open(kurs, unit.id, page)}
                            className={`w-full truncate rounded px-1.5 py-1 text-left text-[13px] transition-colors ${
                              selected?.id === page.id
                                ? 'bg-brand/10 font-medium text-brand'
                                : 'text-gray-600 hover:bg-gray-100'
                            }`}
                          >
                            {page.title}
                          </button>
                        </li>
                      ))}
                      {unit.lessons.length === 0 && (
                        <li className="px-1.5 py-1 text-xs text-gray-300">keine Lernseiten</li>
                      )}
                    </ul>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </aside>

      <div className="min-w-0 flex-1">
        {status && (
          <p className="mb-4 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
            {status}
          </p>
        )}

        {!selected ? (
          <p className="rounded-lg border border-dashed border-gray-300 px-4 py-16 text-center text-sm text-gray-400">
            Wähle links eine Lernseite — oder lege mit &bdquo;+&ldquo; eine neue in einer Einheit an.
          </p>
        ) : (
          <LessonEditor
            key={selected.id}
            page={{ id: selected.id, title: selected.title, content: selected.lesson }}
          />
        )}
      </div>
    </div>
  )
}

interface SelectedPage {
  id: string
  kursId: string
  unitId: string
  title: string
  lesson: LatestLessonJson
}

function findInitialSelection(
  tree: LessonWorkspaceKurs[],
  documentId: string | undefined
): SelectedPage | null {
  if (!documentId) return null

  for (const kurs of tree) {
    for (const unit of kurs.units) {
      const page = unit.lessons.find((lesson) => lesson.id === documentId)
      if (!page) continue
      if (page.content == null) {
        return {
          id: page.id,
          kursId: kurs.id,
          unitId: unit.id,
          title: page.title,
          lesson: emptyLessonJson(),
        }
      }
      const result = readLessonJson(page.content)
      if (!result.ok) return null
      return {
        id: page.id,
        kursId: kurs.id,
        unitId: unit.id,
        title: page.title,
        lesson: result.lesson,
      }
    }
  }
  return null
}

function TypeBadge({ kurs }: { kurs: LessonWorkspaceKurs }) {
  return (
    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-gray-500 uppercase">
      {kurs.kurs_type === 'lernkurs' ? 'Lernkurs' : 'Musterlösung'}
    </span>
  )
}
