import type { DocumentWithAncestry } from '@/types'
import { DocumentBody } from './DocumentBody'

/**
 * One Dokument at page scale — where it lives, what it is called, and its
 * body — for both surfaces that show a document whole: the addressable full
 * page (#69) and the intercepted overlay (#70).
 *
 * The pair below `DocumentBody`: that component owns "which render path does
 * this file_type take", this one owns "what surrounds it at page scale". The
 * Unit accordion shares only the first, because it shows a document at list
 * scale with its own heading; these two surfaces share both, and are therefore
 * identical apart from the chrome the caller wraps around them — a back link
 * on the page, a close button on the overlay.
 *
 * The breadcrumb is not decoration. Someone arriving from a bookmark or a
 * classmate's link has no history behind them, and someone reading the overlay
 * has lost sight of the page underneath, so the document says where it lives
 * in both cases.
 */
export function DocumentArticle({
  view,
  watermarkId,
  titleId,
}: {
  view: DocumentWithAncestry
  watermarkId: string
  /** Set by the overlay, which labels its dialog with the document's title. */
  titleId?: string
}) {
  const { document, task, unit, kurs } = view

  return (
    <article>
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
        {kurs.title} · {unit.title} · {task.title}
      </p>
      <h1 id={titleId} className="mt-1 text-4xl font-black tracking-[0] text-black">
        {document.title}
      </h1>
      {document.description && (
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-gray-600">
          {document.description}
        </p>
      )}
      <div className="mt-6">
        <DocumentBody doc={document} watermarkId={watermarkId} />
      </div>
    </article>
  )
}

/**
 * The same three bars in the same three places, for whichever surface is
 * waiting on the document: the full page's `loading.tsx` adds its back link
 * above this, the overlay renders it inside the dialog it has already opened.
 */
export function DocumentArticleSkeleton() {
  return (
    <>
      <div className="h-3 w-56 animate-pulse rounded bg-gray-100" />
      <div className="mt-2 h-9 w-80 max-w-full animate-pulse rounded-md bg-gray-100" />
      <div className="mt-8 h-64 animate-pulse rounded-md bg-gray-100" />
    </>
  )
}
