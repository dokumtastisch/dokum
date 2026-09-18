'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Eye } from 'lucide-react'
import { saveLesson } from '@/actions/admin'
import { KursSidebar, type KursSidebarUnit } from '@/components/kurse/KursSidebar'
import { DocumentRevealProvider } from '@/components/kurse/document-reveal'
import { emptyLessonJson, type LatestLessonJson } from '@/lib/lessons/lesson-json'
import { readLessonJson } from '@/lib/lessons/lesson-version'
import { BlockEditor } from './BlockEditor'
import { LessonUnitHeader, LessonUnitSection, LessonView } from './LessonView'

export interface LessonEditorPage {
  id: string
  title: string
  content: unknown
}

export interface LessonEditorPreview {
  kursId: string
  kursTitle: string
  units: KursSidebarUnit[]
  unitId: string
  unitTitle: string
  unitDescription: string | null
  unitNumber: number | null
  lessonIndex: number
  lessonCount: number
}

interface LessonDraft {
  id: string
  title: string
  lesson: LatestLessonJson
  dirty: boolean
}

interface LessonEditorState {
  draft: LessonDraft | null
  status: string | null
}

/**
 * The reusable Lernseiten editor. Both the catalogue workspace and a course's
 * own sidebar render this exact component, so saving and preview behaviour do
 * not drift between two editing surfaces.
 */
export function LessonEditor({
  page,
  preview,
}: {
  page: LessonEditorPage
  preview?: LessonEditorPreview
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [previewOpen, setPreviewOpen] = useState(false)
  const [state, setState] = useState<LessonEditorState>(() => initialEditorState(page))
  const draft = state.draft

  function updateDraft(next: LessonDraft) {
    setState({ draft: next, status: null })
  }

  function save() {
    if (!draft) return
    const form = new FormData()
    form.set('document_id', draft.id)
    form.set('title', draft.title)
    form.set('content', JSON.stringify(draft.lesson))
    startTransition(async () => {
      const result = await saveLesson(form)
      if (result.ok) {
        setState((current) => ({
          draft: current.draft ? { ...current.draft, dirty: false } : null,
          status: 'Gespeichert.',
        }))
        router.refresh()
      } else {
        setState((current) => ({ ...current, status: result.error }))
      }
    })
  }

  if (!draft) {
    return (
      <p className="rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700">
        {state.status ?? 'Diese Lernseite konnte nicht geöffnet werden.'}
      </p>
    )
  }

  if (previewOpen) {
    if (preview) {
      return (
        <div className="fixed inset-x-0 bottom-0 top-[66px] z-40 overflow-y-auto border-t border-gray-200 bg-[#fffdf8]">
          <DocumentRevealProvider>
            <div
              className="flex min-h-full flex-col lg:flex-row"
              style={{ minHeight: 'calc(100svh - 66px)' }}
            >
              <KursSidebar
                kursId={preview.kursId}
                kursTitle={preview.kursTitle}
                // The preview only ever shows a Lernkurs — it is the preview OF
                // a Lernseite.
                kursType="lernkurs"
                units={preview.units}
                activeUnitId={preview.unitId}
                activeLessonId={draft.id}
              />
              <div className="min-w-0 flex-1 px-5 py-8 sm:px-8 lg:px-12 lg:py-10">
                <button
                  type="button"
                  onClick={() => setPreviewOpen(false)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none fixed top-[82px] right-5 z-20 shadow-md sm:right-8 lg:right-12"
                >
                  <ArrowLeft className="size-4" />
                  Zurück zum Bearbeiten
                </button>
                <LessonUnitHeader
                  title={preview.unitTitle}
                  description={preview.unitDescription}
                  unitNumber={preview.unitNumber}
                  isLernkurs
                />
                <LessonUnitSection
                  lesson={draft.lesson}
                  title={draft.title}
                  unitNumber={preview.unitNumber}
                  lessonIndex={preview.lessonIndex}
                  lessonCount={preview.lessonCount}
                />
              </div>
            </div>
          </DocumentRevealProvider>
        </div>
      )
    }

    return (
      <div>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-4">
          <div>
            <p className="text-xs font-bold tracking-[0.1em] text-gray-400 uppercase">
              Seitenvorschau
            </p>
            <p className="mt-1 text-sm text-gray-500">
              Vorschau des aktuellen Entwurfs – auch ungespeicherte Änderungen sind sichtbar.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPreviewOpen(false)}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
          >
            <ArrowLeft className="size-4" />
            Zurück zum Bearbeiten
          </button>
        </div>

        <div className="mx-auto min-h-[560px] max-w-4xl rounded-xl border border-gray-200 bg-[#fffdf8] px-6 py-8 shadow-sm sm:px-10 sm:py-10">
          <LessonView
            key={JSON.stringify(draft.lesson)}
            lesson={draft.lesson}
            title={draft.title || 'Ohne Titel'}
          />
        </div>
      </div>
    )
  }

  return (
    <div>
      {state.status && (
        <p className="mb-4 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
          {state.status}
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Titel</span>
          <input
            type="text"
            value={draft.title}
            onChange={(event) => updateDraft({ ...draft, title: event.target.value, dirty: true })}
            placeholder="Titel der Lernseite"
            className="w-full border-0 bg-transparent px-0 py-1 text-3xl font-bold tracking-tight outline-none placeholder:text-gray-300 focus:ring-0"
          />
        </label>
        <div className="flex items-center gap-3">
          {draft.dirty && <span className="text-xs text-amber-600">Ungespeichert</span>}
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
          >
            <Eye className="size-4" />
            Vorschau öffnen
          </button>
          <button
            type="button"
            onClick={save}
            disabled={pending || !draft.title.trim()}
            className="btn-brand rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand/90 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none disabled:opacity-50"
          >
            {pending ? 'Speichert…' : 'Speichern'}
          </button>
        </div>
      </div>

      <p className="mb-5 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-500">
        Speichern schreibt direkt in den Kurs. Ist der Kurs veröffentlicht, sehen Studierende die
        Änderung sofort — der kursweite Entwurfsmodus ist noch nicht gebaut.
      </p>

      <BlockEditor
        lesson={draft.lesson}
        onChange={(lesson) => updateDraft({ ...draft, lesson, dirty: true })}
      />
    </div>
  )
}

function initialEditorState(page: LessonEditorPage): LessonEditorState {
  if (page.content == null) {
    return {
      draft: { id: page.id, title: page.title, lesson: emptyLessonJson(), dirty: false },
      status: null,
    }
  }

  const result = readLessonJson(page.content)
  if (!result.ok) return { draft: null, status: result.error }

  return {
    draft: { id: page.id, title: page.title, lesson: result.lesson, dirty: false },
    status: null,
  }
}
