'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createDocument, updateDocument } from '@/actions/admin'
import type { Task, Unit, Kurs } from '@/types'
// Aliased: the global DOM `Document` is in scope in a client component, and an
// unaliased import would shadow it in a file that also touches the DOM.
import type { Document as DokumentRow } from '@/types'
import type { ActionResult } from '@/types'
import { METADATA_ONLY_FILE_TYPES } from '@/lib/document-view'

type FormState = ActionResult | null

const initialState: FormState = null

type TaskWithUnit = Task & { units: Unit & { kurse: Pick<Kurs, 'title'> } }

/**
 * The kinds this form can actually upload — `interactive` is authored in the
 * editor, `lesson` in the Lernseiten workspace (#107).
 */
type UploadableType = 'pdf' | 'image' | 'image_collection'

/**
 * Narrows a stored file_type to one the type selector can stand on. Everything
 * else falls back to 'pdf', which is only ever read on the create path — the
 * selector and the file input are hidden while editing a metadata-only kind.
 */
function isUploadable(
  fileType: DokumentRow['file_type'] | undefined
): fileType is UploadableType {
  return fileType === 'pdf' || fileType === 'image' || fileType === 'image_collection'
}

type DefaultValues = {
  title: string
  description: string | null
  position: number
  file_path?: string | null
  file_type?: DokumentRow['file_type']
}

export function DocumentForm({
  tasks,
  onTaskChange,
  defaultTaskId = '',
  editId,
  defaultValues,
}: {
  tasks: TaskWithUnit[]
  onTaskChange?: (taskId: string) => void
  defaultTaskId?: string
  editId?: string
  defaultValues?: DefaultValues
}) {
  const router = useRouter()
  const [fileError, setFileError] = useState<string | null>(null)
  // Only ever read on the create path (the type selector and file input are
  // hidden while editing a metadata-only kind), so an `interactive` default
  // just falls back to the same 'pdf' the create form starts on.
  const [docType, setDocType] = useState<UploadableType>(
    isUploadable(defaultValues?.file_type) ? defaultValues.file_type : 'pdf'
  )
  const [state, action, pending] = useActionState(
    async (_prev: FormState, formData: FormData): Promise<FormState> => {
      return editId ? await updateDocument(editId, formData) : await createDocument(formData)
    },
    initialState
  )

  useEffect(() => {
    if (state?.ok === true) router.refresh()
  }, [state?.ok, router])

  function validateFiles(files: FileList | null) {
    if (!files) return
    for (const file of Array.from(files)) {
      if (file.size > 4 * 1024 * 1024) {
        setFileError(`"${file.name}" ist zu groß (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximal 4 MB pro Datei.`)
        return
      }
    }
    setFileError(null)
  }

  // Kinds whose file `updateDocument` refuses to replace — the form must not
  // offer an upload the action silently discards while reporting success
  // (#86). The list and the reasoning now live in ONE place that both this
  // form and the server action read, instead of two that had to be kept in
  // step by hand (see METADATA_ONLY_FILE_TYPES).
  const editingFileType = editId ? defaultValues?.file_type : undefined
  const isMetadataOnly = editingFileType !== undefined && METADATA_ONLY_FILE_TYPES.has(editingFileType)

  return (
    <form action={action} className="flex flex-col gap-5">
      {state?.ok === false && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {state.error}
        </p>
      )}
      {state?.ok === true && (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-3">
          <p className="text-sm font-medium text-green-800">
            {editId ? 'Dokument erfolgreich aktualisiert!' : 'Dokument erfolgreich hochgeladen!'}
          </p>
          <div className="mt-3">
            <Link
              href="/admin"
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            >
              ← Zurück zur Übersicht
            </Link>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="doc-task" className="text-sm font-medium text-gray-700">
          Task <span className="text-red-500">*</span>
        </label>
        <select
          id="doc-task"
          name="task_id"
          required
          defaultValue={defaultTaskId}
          disabled={!!editId}
          onChange={(e) => onTaskChange?.(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand disabled:bg-gray-50 disabled:text-gray-500"
        >
          <option value="">— Select a Task —</option>
          {tasks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.units.kurse.title} › {t.units.title} › {t.title}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="doc-title" className="text-sm font-medium text-gray-700">
          Title <span className="text-red-500">*</span>
        </label>
        <input
          id="doc-title"
          name="title"
          type="text"
          required
          defaultValue={defaultValues?.title ?? ''}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="doc-description" className="text-sm font-medium text-gray-700">
          Description
        </label>
        <textarea
          id="doc-description"
          name="description"
          rows={3}
          defaultValue={defaultValues?.description ?? ''}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </div>

      {/* Document type selector — only shown when creating */}
      {!editId && (
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Typ</label>
          <div className="flex gap-3">
            {(['pdf', 'image', 'image_collection'] as const).map((t) => (
              <label key={t} className="flex items-center gap-1.5 cursor-pointer text-sm text-gray-700">
                <input
                  type="radio"
                  name="doc_type"
                  value={t}
                  checked={docType === t}
                  onChange={() => { setDocType(t); setFileError(null) }}
                  className="accent-brand"
                />
                {t === 'pdf' ? 'PDF' : t === 'image' ? 'Bild (einzeln)' : 'Bildsammlung'}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* File input */}
      {isMetadataOnly ? (
        <p className="text-xs text-gray-400 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
          {editingFileType === 'interactive'
            ? 'Interaktive Dokumente werden im LaTeX-Editor bearbeitet und dort erneut veröffentlicht. Hier sind nur Titel, Beschreibung und Position änderbar.'
            : 'Bildsammlungen können derzeit nicht bearbeitet werden. Nur Titel, Beschreibung und Position sind änderbar.'}
        </p>
      ) : docType === 'image_collection' ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="doc-images" className="text-sm font-medium text-gray-700">
            Bilder <span className="text-red-500">*</span>
          </label>
          <input
            id="doc-images"
            name="images"
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            multiple
            required
            className="text-sm text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-200"
            onChange={(e) => validateFiles(e.target.files)}
          />
          {fileError && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {fileError}
            </p>
          )}
          <p className="text-xs text-gray-400">JPEG, PNG, GIF oder WebP. Max 4 MB pro Bild.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <label htmlFor="doc-pdf" className="text-sm font-medium text-gray-700">
            Datei {!editId && <span className="text-red-500">*</span>}
          </label>
          {editId && defaultValues?.file_path && (
            <p className="text-xs text-gray-500">
              Aktuell: <span className="font-mono">{defaultValues.file_path.split('/').pop()}</span>
            </p>
          )}
          <input
            id="doc-pdf"
            name="pdf"
            type="file"
            accept={docType === 'image' ? 'image/jpeg,image/png,image/gif,image/webp' : 'application/pdf,image/jpeg,image/png,image/gif,image/webp'}
            required={!editId}
            className="text-sm text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-200"
            onChange={(e) => validateFiles(e.target.files)}
          />
          {fileError && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {fileError}
            </p>
          )}
          <p className="text-xs text-gray-400">
            {editId ? 'Kein Upload = aktuelle Datei beibehalten. Max 4 MB.' : docType === 'image' ? 'JPEG, PNG, GIF oder WebP. Max 4 MB.' : 'PDF, JPEG, PNG, GIF oder WebP. Max 4 MB.'}
          </p>
        </div>
      )}

      {/* The order is dragged in the tree, not typed here — but `position` is
          still what the schema reads, and `positionField` DEFAULTS TO 0. A form
          that simply left the field out would send every edited Dokument to the
          top of its Aufgabe. So the current value rides along hidden. */}
      <input type="hidden" name="position" value={defaultValues?.position ?? 0} />

      <button
        type="submit"
        disabled={pending || !!fileError}
        className="self-start rounded-md border border-brand px-4 py-2 text-sm font-medium text-brand hover:bg-brand/5 disabled:opacity-50 btn-brand"
      >
        {pending ? 'Saving…' : editId ? 'Aktualisieren' : 'Add Document'}
      </button>
    </form>
  )
}
