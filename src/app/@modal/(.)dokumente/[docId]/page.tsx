import { Suspense } from 'react'
import { DocumentArticle, DocumentArticleSkeleton } from '@/components/documents/DocumentArticle'
import { DocumentOverlay } from '@/components/documents/DocumentOverlay'
import { loadDocumentSurface } from '@/lib/document-surface'

interface Props {
  params: Promise<{ docId: string }>
}

// One dialog, one label. The heading that carries this id is rendered by
// whichever of the three states below is on screen, so the dialog is never
// unlabelled — not while it is loading and not when the document is refused.
const TITLE_ID = 'dokument-overlay-title'

/**
 * A Dokument opened from INSIDE the app: the same document as
 * `/dokumente/[docId]`, on top of the page the student came from (#70).
 *
 * This is the App Router's intercepting route, and the interception is the
 * feature. Only a client-side navigation is caught here; a pasted URL, a
 * bookmark and a reload are hard navigations, so they miss this file entirely
 * and render the full page — one URL, two presentations, no branch in our
 * code deciding which.
 *
 * THE SHELL IS RENDERED OUTSIDE THE SUSPENSE BOUNDARY ON PURPOSE. It costs
 * nothing to produce — no database read — so the overlay is on screen while
 * the document is still being fetched, and it is the SAME dialog element
 * before and after, which is what keeps focus where `showModal()` put it. A
 * `loading.tsx` at this level would open a dialog and then swap it for a
 * second one, moving focus mid-navigation.
 */
export default async function InterceptedDocumentPage({ params }: Props) {
  const { docId } = await params

  return (
    <DocumentOverlay titleId={TITLE_ID}>
      <Suspense fallback={<OverlaySkeleton />}>
        <OverlayDocument docId={docId} />
      </Suspense>
    </DocumentOverlay>
  )
}

async function OverlayDocument({ docId }: { docId: string }) {
  const surface = await loadDocumentSurface(docId)
  // Unknown id, no entitlement, archived Kurs — the same three cases the full
  // page collapses into one 404, said inside the overlay instead of throwing
  // the student out of the page they were reading. Nothing here names which of
  // the three it was; #74 is where a locked target earns a better answer than
  // this one.
  if (!surface) return <OverlayNotFound />

  return (
    <DocumentArticle view={surface.view} watermarkId={surface.watermarkId} titleId={TITLE_ID} />
  )
}

function OverlayNotFound() {
  return (
    <div className="py-10 text-center">
      <h1 id={TITLE_ID} className="text-xl font-semibold text-gray-900">
        Document not found
      </h1>
      <p className="mt-2 text-sm text-gray-500">
        This document does not exist or is not unlocked for you.
      </p>
    </div>
  )
}

function OverlaySkeleton() {
  return (
    <div aria-busy="true">
      <h1 id={TITLE_ID} className="sr-only">
        Loading document
      </h1>
      <DocumentArticleSkeleton />
    </div>
  )
}
