// CURRENTLY UNUSED — no page imports this component. Its target route does
// exist now (#69), and the link goes through DocumentLink like every other
// in-app document link (#70), so this cannot drift out of date a second time.
import type { Document } from '@/types'
import { DocumentLink } from './DocumentLink'

export function DocumentCard({ document }: { document: Document }) {
  return (
    <DocumentLink
      docId={document.id}
      className="block rounded-lg border border-gray-200 bg-white p-5 shadow-sm transition hover:shadow-md hover:border-gray-300"
    >
      <h2 className="text-base font-semibold text-gray-900">{document.title}</h2>
      {document.description && (
        <p className="mt-1 text-sm text-gray-500 line-clamp-2">{document.description}</p>
      )}
      <span className="mt-3 inline-block text-xs font-medium text-gray-400">
        View document →
      </span>
    </DocumentLink>
  )
}
