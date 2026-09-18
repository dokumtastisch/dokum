'use client'

import { DocumentErrorPanel } from '@/components/documents/DocumentErrorPanel'

export default function DocumentError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <DocumentErrorPanel reset={reset} />
}
