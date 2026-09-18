'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Task, DocumentWithImages } from '@/types'
import { DocumentBody } from '@/components/documents/DocumentBody'
import { DocumentLink } from '@/components/documents/DocumentLink'
import { useRegisterDocumentReveal } from '@/components/kurse/document-reveal'
import { documentAnchorId, REVEAL_UNFOLD_MS } from '@/lib/document-anchor'
import { documentViewKind } from '@/lib/document-view'
import Lightbox from 'yet-another-react-lightbox'
import Zoom from 'yet-another-react-lightbox/plugins/zoom'
import 'yet-another-react-lightbox/styles.css'

type TaskWithDocs = Task & { documents: DocumentWithImages[] }

interface LightboxState {
  slides: { src: string }[]
  index: number
}

function trackMiniCase(docId: string) {
  const raw = document.cookie
    .split('; ')
    .find((row) => row.startsWith('recent_minicases='))
    ?.split('=')[1]
  const ids = raw ? decodeURIComponent(raw).split(',').filter(Boolean) : []
  const next = [docId, ...ids.filter((id) => id !== docId)].slice(0, 4)
  document.cookie = `recent_minicases=${encodeURIComponent(next.join(','))}; path=/; max-age=${60 * 60 * 24 * 30}`
}

export default function UnitDetailClient({ tasks, openTaskId, watermarkId }: { tasks: TaskWithDocs[]; openTaskId?: string; watermarkId: string }) {
  const [openTaskIds, setOpenTaskIds] = useState<Set<string>>(openTaskId ? new Set([openTaskId]) : new Set())
  const [lightbox, setLightbox] = useState<LightboxState | null>(null)

  // `openTaskId` is not only a deep link. Its two producers — the back link on
  // /dokumente/[docId] and RecentMiniCases — are soft navigations that can land
  // on an Einheit whose accordion is ALREADY MOUNTED, changing this prop without
  // remounting the component. Without the adjustment below, the initial state
  // above would be the only time the prop was ever read.
  //
  // Adjusted during render rather than in an effect (React's documented
  // prop-change pattern): the accordion is not an external system, and an
  // effect would paint the old state once before opening.
  //
  // It only ever OPENS. A student who collapsed the Aufgabe they arrived
  // through should not have it spring back open on an unrelated re-render,
  // which is exactly what re-deriving from the prop each time would do.
  const [lastOpenedTaskId, setLastOpenedTaskId] = useState(openTaskId)
  if (openTaskId && openTaskId !== lastOpenedTaskId) {
    setLastOpenedTaskId(openTaskId)
    setOpenTaskIds((prev) => (prev.has(openTaskId) ? prev : new Set(prev).add(openTaskId)))
  }

  // The accordion's half of the sidebar channel (#106): unfold the Aufgabe that
  // holds this Dokument, then scroll to it. Nothing navigates and nothing opens
  // — the Dokument is already rendered right here.
  //
  // The wait is the accordion's own animation. `grid-template-rows` goes 0fr →
  // 1fr over 300ms below, and an element measured mid-expansion scrolls to the
  // wrong offset; when the Aufgabe was already unfolded there is nothing to wait
  // for and the scroll happens on the spot.
  const register = useRegisterDocumentReveal()
  const reveal = useCallback(
    (docId: string) => {
      const task = tasks.find((t) => t.documents.some((d) => d.id === docId))
      if (!task) return

      // Read from state, NOT from inside an updater: React does not run the
      // updater at dispatch time, so a `wasOpen` assigned in there would still
      // hold its initial value by the time the timeout below is scheduled.
      const wasOpen = openTaskIds.has(task.id)
      if (!wasOpen) {
        task.documents.forEach((doc) => trackMiniCase(doc.id))
        setOpenTaskIds((prev) => new Set(prev).add(task.id))
      }

      window.setTimeout(
        () =>
          document
            .getElementById(documentAnchorId(docId))
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        wasOpen ? 0 : REVEAL_UNFOLD_MS
      )
    },
    [tasks, openTaskIds]
  )
  useEffect(() => register(reveal), [register, reveal])

  function toggleTask(taskId: string, docs: DocumentWithImages[]) {
    setOpenTaskIds((prev) => {
      const next = new Set(prev)
      if (next.has(taskId)) {
        next.delete(taskId)
      } else {
        next.add(taskId)
        docs.forEach((doc) => trackMiniCase(doc.id))
      }
      return next
    })
  }

  if (tasks.length === 0) {
    return <p className="mt-8 text-sm text-gray-500">No tasks yet.</p>
  }

  return (
    <>
    {/* onContextMenu wrapper blocks right-click "Save Image" inside the lightbox */}
    <div onContextMenu={(e) => e.preventDefault()}>
      <Lightbox
        open={lightbox !== null}
        close={() => setLightbox(null)}
        slides={lightbox?.slides ?? []}
        index={lightbox?.index ?? 0}
        plugins={[Zoom]}
        zoom={{ scrollToZoom: true, maxZoomPixelRatio: 4 }}
      />
    </div>
    <div className="mt-8 space-y-8">
      {tasks.map((task) => {
        const isOpen = openTaskIds.has(task.id)
        return (
          <section key={task.id}>
            <button
              onClick={() => toggleTask(task.id, task.documents)}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900 transition-colors text-left"
            >
              <span
                className="text-gray-400 transition-transform duration-150"
                style={{ display: 'inline-block', transform: isOpen ? 'rotate(90deg)' : 'none' }}
              >
                ›
              </span>
              <h2 className="text-lg font-semibold text-gray-800">{task.title}</h2>
            </button>

            {task.description && (
              <p className="mt-1 text-sm text-gray-500 pl-8">{task.description}</p>
            )}

            <div
              className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
                isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
              }`}
            >
              <div className="overflow-hidden">
                <div className="ml-6 mt-1 mb-2">
                  {task.documents.length === 0 ? (
                    <p className="px-3 text-xs text-gray-400">No documents yet.</p>
                  ) : (
                    <ul className="space-y-1">
                      {task.documents.map((doc) => {
                        // The body of every document kind lives in
                        // DocumentBody, shared with the full-page route (#69).
                        // Only the layout around it differs here: a PDF puts
                        // its button beside the title, everything else stacks.
                        const heading = (
                          <div>
                            <p className="text-sm font-medium text-gray-800">{doc.title}</p>
                            {doc.description && (
                              <p className="text-xs text-gray-500">{doc.description}</p>
                            )}
                            {/* Opens on top of this Unit page rather than
                                replacing it (#70) — the accordion, and every
                                value a student has typed into a document in
                                it, is still here underneath. */}
                            <DocumentLink
                              docId={doc.id}
                              className="mt-0.5 inline-block text-xs text-gray-400 hover:text-brand"
                            >
                              Open on its own page ↗
                            </DocumentLink>
                          </div>
                        )
                        return (
                          <li
                            key={doc.id}
                            // What the Kurs sidebar scrolls to (#106). The
                            // scroll margin keeps the sticky navbar from
                            // covering the row it just landed on.
                            id={documentAnchorId(doc.id)}
                            className="scroll-mt-20 rounded-md border border-gray-100 bg-gray-50 px-3 py-2"
                          >
                            {documentViewKind(doc) === 'file' ? (
                              <div className="flex items-center justify-between gap-4">
                                {heading}
                                {/* The accordion's scale, applied by the
                                    accordion: the button inherits text-xs and
                                    the wrapper keeps it from being squeezed. */}
                                <div className="shrink-0 text-xs">
                                  <DocumentBody doc={doc} watermarkId={watermarkId} />
                                </div>
                              </div>
                            ) : (
                              <div>
                                {heading}
                                <DocumentBody doc={doc} watermarkId={watermarkId} />
                              </div>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          </section>
        )
      })}
    </div>
    </>
  )
}
