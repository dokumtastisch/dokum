import type { AdminKursWorkspaceDocument } from '@/lib/dal'

/**
 * What actually sits behind a Dokument, shown under the form that edits its
 * metadata.
 *
 * Every source is one of the app's own routes. The `pdfs` bucket is private and
 * a Supabase URL must never reach the browser, so `/api/file/[docId]` and
 * `/api/image/[imageId]` answer with a short-lived signed redirect that the
 * <img> or <iframe> follows.
 *
 * IT BRANCHES ON `file_type` INSTEAD OF CALLING `documentViewKind`, which is
 * the app's usual answer to "which render path?". That function reads `content`
 * to tell a live interactive document from one whose snapshot was never
 * written, and this workspace's query deliberately leaves `content` unselected
 * (dal.ts). Handing it a row without that column would classify every
 * interactive document as a picture and promise a PNG that need not exist.
 * Those rows get a link to the student view instead — the one surface where
 * their renderer actually runs.
 */
export function DocumentPreview({ document }: { document: AdminKursWorkspaceDocument }) {
  return (
    <section className="mt-8 border-t border-gray-100 pt-6">
      <p className="text-[11px] font-bold tracking-[0.1em] text-gray-400 uppercase">Vorschau</p>
      <div className="mt-3">
        <PreviewBody document={document} />
      </div>
    </section>
  )
}

function PreviewBody({ document }: { document: AdminKursWorkspaceDocument }) {
  if (document.file_type === 'interactive' || document.file_type === 'lesson') {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-gray-500">
          {document.file_type === 'lesson'
            ? 'Lernseiten werden aus ihrem Inhalt gerendert, nicht aus einer Datei.'
            : 'Interaktive Dokumente werden aus ihrem Inhalt gerendert, nicht aus einer Datei.'}
        </p>
        <StudentViewLink docId={document.id} />
      </div>
    )
  }

  if (document.file_type === 'image_collection') {
    if (document.document_images.length === 0) {
      return <EmptyNote>Diese Bildsammlung enthält noch keine Bilder.</EmptyNote>
    }
    return (
      <div className="grid grid-cols-1 gap-2">
        {document.document_images.map((image, index) => (
          <div key={image.id} className="flex w-full justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/image/${image.id}`}
              alt={`${document.title} – Seite ${index + 1}`}
              className="block max-h-[400px] max-w-full rounded-md border border-gray-200"
            />
          </div>
        ))}
      </div>
    )
  }

  if (!document.file_path) {
    return <EmptyNote>Zu diesem Dokument ist keine Datei hinterlegt.</EmptyNote>
  }

  if (document.file_type === 'image') {
    return (
      <div className="flex w-full justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/file/${document.id}`}
          alt={document.title}
          className="block max-h-[600px] max-w-full rounded-md border border-gray-200"
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <iframe
        src={`/api/file/${document.id}`}
        title={`Vorschau: ${document.title}`}
        className="h-[520px] w-full rounded-xl border border-gray-200 bg-white"
      />
      {/* A browser that refuses to render a PDF inline leaves the frame blank,
          so the way out of it is always offered. */}
      <a
        href={`/api/file/${document.id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        In neuem Tab öffnen ↗
      </a>
    </div>
  )
}

function StudentViewLink({ docId }: { docId: string }) {
  return (
    <a
      href={`/dokumente/${docId}`}
      target="_blank"
      rel="noopener noreferrer"
      className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
    >
      In der Studentenansicht öffnen ↗
    </a>
  )
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-400">
      {children}
    </p>
  )
}
