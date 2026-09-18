import { AdminSubpageNav } from '@/components/admin/AdminSubpageNav'
import { LessonWorkspace } from '@/components/lessons/LessonWorkspace'
import { getLessonWorkspaceTree } from '@/lib/dal'

// Auth is enforced by the proxy (src/proxy.ts) — the single enforcement point
// for /admin/*. No role check is duplicated here (see CLAUDE.md).

/**
 * The Lernseiten workspace (#107): the whole Kurs tree on the left, the open
 * page on the right.
 *
 * The read is admin-shaped — it pulls `content` for every Lernseite in the
 * catalogue — which is safe here and nowhere else: this route sits behind the
 * proxy's /admin guard, and for a non-admin RLS would return a partial tree
 * that looks like an empty one.
 */
export default async function LernseitenPage({
  searchParams,
}: {
  searchParams: Promise<{ documentId?: string }>
}) {
  const { documentId } = await searchParams
  const tree = await getLessonWorkspaceTree()

  return (
    <main className="mx-auto max-w-[1560px] px-4 py-10">
      <AdminSubpageNav active="lernseiten" />

      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Lernseiten</h1>
        <p className="mt-2 max-w-3xl text-sm text-gray-500">
          Eine Lernseite gehört zu einer Einheit. Sie wird als Dokument gespeichert — deshalb greift
          die Bezahlschranke, die es schon gibt, ohne dass eine neue Regel nötig wäre. Die Aufgabe,
          unter der sie technisch hängt, wird automatisch angelegt und taucht nirgends auf.
        </p>
      </div>

      <LessonWorkspace tree={tree} initialDocumentId={documentId} />
    </main>
  )
}
