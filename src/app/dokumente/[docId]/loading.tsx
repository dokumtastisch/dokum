import { DocumentArticleSkeleton } from '@/components/documents/DocumentArticle'

export default function DocumentLoading() {
  return (
    <div className="mx-auto max-w-5xl px-8 py-10 sm:px-12 lg:px-16">
      {/* The page's own chrome — the back link the overlay does not have. */}
      <div className="mb-8 h-4 w-28 rounded bg-gray-100 animate-pulse" />
      <DocumentArticleSkeleton />
    </div>
  )
}
