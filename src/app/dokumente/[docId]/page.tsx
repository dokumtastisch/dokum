import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DocumentArticle } from '@/components/documents/DocumentArticle'
import { loadDocumentSurface } from '@/lib/document-surface'

interface Props {
  params: Promise<{ docId: string }>
}

/**
 * The addressable full-page view of a single Dokument (#69) — what a pasted,
 * bookmarked or shared URL opens, and what a reload of an overlaid document
 * falls back to (#70).
 *
 * ACCESS IS ENFORCED BY THE EXISTING RULES AND NO NEW ONE — see
 * `loadDocumentSurface`, which both this page and the overlay read through so
 * neither can become the laxer of the two.
 *
 * Every failure — unknown id, no entitlement, archived Kurs — lands on the
 * same 404. Distinguishing them here would leak which documents exist to
 * someone who cannot read them; telling a student "this is in Einheit 3,
 * unlock it" is a separate, deliberately server-side surface (#74).
 */
export default async function DocumentPage({ params }: Props) {
  const { docId } = await params

  const surface = await loadDocumentSurface(docId)
  if (!surface) notFound()

  const { unit, kurs, task } = surface.view
  // Back into the hierarchy at the task this document sits in — the Unit
  // page's existing deep-link parameter opens that accordion section.
  const backHref = `/kurse/${kurs.id}/units/${unit.id}?openTask=${task.id}`

  return (
    <div
      className="-mx-4 border-t border-gray-200 bg-[#fffdf8] sm:-mx-8"
      style={{ minHeight: 'calc(100svh - 66px)' }}
    >
      <div className="mx-auto max-w-5xl px-8 py-10 sm:px-12 lg:px-16">
        <Link
          href={backHref}
          className="mb-8 inline-block text-sm font-medium text-gray-500 hover:text-gray-700"
        >
          ← {unit.title}
        </Link>
        <DocumentArticle view={surface.view} watermarkId={surface.watermarkId} />
      </div>
    </div>
  )
}

// A bookmark is only useful if it carries the document's name. It falls back
// to the layout's title whenever the page itself would 404 — metadata must not
// become a way to learn a title the page refuses to show.
//
// #69 evaluated that rule as though the reader were never an admin, to avoid
// an auth round-trip here. Sharing the loader with the page removes the reason:
// it is `cache`d per request, so the auth call and the query happen once for
// both. The visible consequence is that an admin now gets the real tab title
// for a document in an ARCHIVED Kurs, matching the page they are looking at
// instead of contradicting it.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { docId } = await params
  const surface = await loadDocumentSurface(docId)
  if (!surface) return {}
  return { title: `${surface.view.document.title} – Dokum` }
}
