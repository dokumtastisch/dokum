'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { deleteKurs, deleteUnit, deleteTask, deleteDocument, scanDocumentBacklinks } from '@/actions/admin'
import { backlinkDeleteWarning, backlinkScanFailedWarning } from '@/lib/editor/backlinks'

type DocumentItem = { id: string; title: string; position: number; created_at: string; file_type?: string; document_images?: { id: string }[] }
type TaskItem = { id: string; title: string; position: number; created_at: string; documents?: DocumentItem[] }
type UnitItem = { id: string; title: string; position: number; created_at: string; tasks?: TaskItem[] }
type KursItem = { id: string; title: string; units?: UnitItem[] }

type Props = {
  kurse: KursItem[]
  selectedId?: string
  deleteLevel?: 'kurs' | 'unit' | 'task' | 'document'
}

function sort<T extends { position: number; created_at: string }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at)
  )
}

const confirmMessages = {
  kurs: (t: string) => `Kurs "${t}" und alle zugehörigen Units, Tasks und Dokumente wirklich löschen?`,
  unit: (t: string) => `Unit "${t}" und alle zugehörigen Tasks und Dokumente wirklich löschen?`,
  task: (t: string) => `Task "${t}" und alle zugehörigen Dokumente wirklich löschen?`,
  document: (t: string) => `Dokument "${t}" wirklich löschen?`,
}

const deleteActions = { kurs: deleteKurs, unit: deleteUnit, task: deleteTask, document: deleteDocument }

/**
 * What the admin should know before deleting this Dokument, or `null` when
 * nothing links to it — in which case the confirm stays exactly the plain
 * question it was before backlinks existed (#75).
 *
 * ⚠ A FAILED SCAN IS SAID OUT LOUD AND NEVER BLOCKS. Returning `null` here
 * would let „the check could not run" masquerade as „nothing links here", which
 * is the one outcome the warning exists to prevent; refusing the delete would
 * be worse still, because a broken scan would then lock the admin out of their
 * own catalogue. So: name the failure, and let them decide.
 */
async function documentDeleteWarning(docId: string): Promise<string | null> {
  try {
    const result = await scanDocumentBacklinks(docId)
    if (result.ok) return backlinkDeleteWarning(result.data)
    return backlinkScanFailedWarning('dieses Dokument', result.error)
  } catch {
    return backlinkScanFailedWarning('dieses Dokument')
  }
}

const editHrefs = {
  kurs: (id: string) => `/admin/kurse/${id}`,
  unit: (id: string) => `/admin/units/new?editId=${id}`,
  task: (id: string) => `/admin/tasks/new?editId=${id}`,
  document: (id: string) => `/admin/documents/new?editId=${id}`,
}

export function AdminTree({ kurse, selectedId = '', deleteLevel }: Props) {
  const router = useRouter()
  const [loadingId, setLoadingId] = useState<string | null>(null)

  async function handleDelete(id: string, title: string, level: keyof typeof deleteActions) {
    // Deleting a Dokument something links to breaks that link, so the scan runs
    // BEFORE the confirm and its result becomes part of the question (#75).
    // Only the document level: a Kurs/Unit/Task delete cascades whole subtrees
    // and would need a different, per-descendant scan — out of scope here.
    setLoadingId(id)
    try {
      const warning = level === 'document' ? await documentDeleteWarning(id) : null
      const question = confirmMessages[level](title)
      if (!window.confirm(warning ? `${question}\n\n${warning}\n\nTrotzdem löschen?` : question)) {
        return
      }
      const result = await deleteActions[level](id)
      if (!result.ok) alert(`Fehler: ${result.error}`)
      else router.refresh()
    } finally {
      setLoadingId(null)
    }
  }

  function itemBtns(id: string, title: string, level: keyof typeof deleteActions) {
    return (
      <div className="flex items-center gap-1">
        {deleteLevel === level && (
          <button
            onClick={() => router.push(editHrefs[level](id))}
            className="shrink-0 text-gray-300 transition-colors hover:text-blue-500"
            title="Bearbeiten"
          >
            ✎
          </button>
        )}
        {deleteLevel === level && (
          <button
            onClick={() => handleDelete(id, title, level)}
            disabled={loadingId === id}
            className="shrink-0 text-gray-300 transition-colors hover:text-red-500 disabled:opacity-50"
            title={`${level.charAt(0).toUpperCase() + level.slice(1)} löschen`}
          >
            ✕
          </button>
        )}
      </div>
    )
  }

  if (kurse.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-400">
        Noch keine Kurse vorhanden.
      </div>
    )
  }

  return (
    <div className="max-w-sm space-y-3">
      {kurse.map((kurs) => (
        <div
          key={kurs.id}
          className={`rounded-lg border p-4 transition-colors ${
            kurs.id === selectedId
              ? 'border-brand bg-gray-50 ring-1 ring-brand'
              : 'border-gray-200 bg-white'
          }`}
        >
          <div className="flex min-w-0 items-center justify-between gap-2">
            <p className="truncate text-sm font-semibold text-gray-900" title={kurs.title}>{kurs.title}</p>
            {itemBtns(kurs.id, kurs.title, 'kurs')}
          </div>

          {kurs.units !== undefined && (
            kurs.units.length === 0 ? (
              <p className="mt-2 ml-3 text-xs text-gray-400 italic">Noch keine Units</p>
            ) : (
              <div className="mt-2 space-y-2">
                {sort(kurs.units).map((unit) => (
                  <div
                    key={unit.id}
                    className={`ml-3 rounded-md border p-2 transition-colors ${
                      unit.id === selectedId
                        ? 'border-brand bg-gray-50 ring-1 ring-brand'
                        : 'border-gray-100'
                    }`}
                  >
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <p className="truncate text-xs font-medium text-gray-700" title={unit.title}>{unit.title}</p>
                      {itemBtns(unit.id, unit.title, 'unit')}
                    </div>

                    {unit.tasks !== undefined && (
                      unit.tasks.length === 0 ? (
                        <p className="mt-1 ml-3 text-xs text-gray-400 italic">Noch keine Tasks</p>
                      ) : (
                        <div className="mt-1 space-y-1">
                          {sort(unit.tasks).map((task) => (
                            <div
                              key={task.id}
                              className={`ml-3 rounded border px-2 py-1 transition-colors ${
                                task.id === selectedId
                                  ? 'border-brand bg-gray-50 ring-1 ring-brand'
                                  : 'border-gray-100'
                              }`}
                            >
                              <div className="flex min-w-0 items-center justify-between gap-2">
                                <p className="truncate text-xs text-gray-600" title={task.title}>{task.title}</p>
                                {itemBtns(task.id, task.title, 'task')}
                              </div>

                              {task.documents !== undefined && (
                                task.documents.length === 0 ? (
                                  <p className="mt-1 ml-3 text-xs text-gray-400 italic">
                                    Noch keine Dokumente
                                  </p>
                                ) : (
                                  <ul className="mt-1 space-y-0.5">
                                    {sort(task.documents).map((doc) => (
                                      <li
                                        key={doc.id}
                                        className="ml-3 flex min-w-0 items-center justify-between gap-2 text-xs text-gray-500"
                                      >
                                        <span className="flex min-w-0 items-center gap-2">
                                          <span className="shrink-0 text-gray-300">›</span>
                                          <span className="truncate" title={doc.title}>{doc.title}</span>
                                          {doc.file_type === 'image_collection' && (
                                            <span className="shrink-0 rounded bg-gray-100 px-1 py-0.5 text-[10px] text-gray-400">
                                              {doc.document_images?.length ?? 0} Bilder
                                            </span>
                                          )}
                                        </span>
                                        {itemBtns(doc.id, doc.title, 'document')}
                                      </li>
                                    ))}
                                  </ul>
                                )
                              )}
                            </div>
                          ))}
                        </div>
                      )
                    )}
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      ))}
    </div>
  )
}
