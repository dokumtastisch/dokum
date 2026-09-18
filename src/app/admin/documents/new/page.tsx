import Link from 'next/link'
import { getDocumentById, getAllKurseDeep } from '@/lib/dal'
import { DocumentPageClient } from '@/components/admin/DocumentPageClient'
import { AdminSubpageNav } from '@/components/admin/AdminSubpageNav'
import type { Document as DocumentRow } from '@/types'

export default async function NewDocumentPage({
  searchParams,
}: {
  searchParams: Promise<{ taskId?: string; editId?: string }>
}) {
  const { taskId, editId } = await searchParams

  let defaultTaskId = taskId ?? ''
  // 'interactive' is produced by publishing an editor draft (#66), never
  // uploaded through this form. It MUST reach the form as itself (#85/#86):
  // erasing it to undefined made the form fall back to its 'pdf' default and
  // render a working file picker whose upload `updateDocument` then discarded,
  // reporting success. The form gates the file input on this value.
  let editDefaults:
    | {
        title: string
        description: string | null
        position: number
        file_path: string | null
        file_type?: DocumentRow['file_type']
      }
    | undefined
  if (editId) {
    const data = await getDocumentById(editId)
    if (data) {
      editDefaults = {
        title: data.title,
        description: data.description,
        position: data.position,
        file_path: data.file_path,
        file_type: data.file_type,
      }
      defaultTaskId = data.task_id
    }
  }

  const kurse = await getAllKurseDeep()

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <AdminSubpageNav active="documents" />
      <div className="mb-8 flex items-baseline gap-4">
        <h1 className="text-2xl font-bold text-gray-900">
          {editId ? 'Dokument bearbeiten' : 'Dokument hinzufügen'}
        </h1>
        {editId && (
          <Link href="/admin/documents/new" className="text-sm text-brand hover:underline">
            + Neues Dokument hinzufügen
          </Link>
        )}
      </div>
      <DocumentPageClient
        key={editId ?? 'new'}
        kurseTree={kurse}
        defaultTaskId={defaultTaskId}
        editId={editId}
        defaultValues={editDefaults}
      />
    </main>
  )
}
