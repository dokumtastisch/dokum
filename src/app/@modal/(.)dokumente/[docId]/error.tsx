'use client'

import { DocumentErrorPanel } from '@/components/documents/DocumentErrorPanel'
import { DocumentOverlay } from '@/components/documents/DocumentOverlay'

const ERROR_TITLE_ID = 'dokument-overlay-error-title'

/**
 * A failure while loading the overlaid document. It keeps the dialog rather
 * than replacing the slot with a bare error block, because the page the
 * student was reading is still mounted underneath and they need the close
 * button to get back to it.
 */
export default function DocumentOverlayError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <DocumentOverlay titleId={ERROR_TITLE_ID}>
      <DocumentErrorPanel reset={reset} headingId={ERROR_TITLE_ID} />
    </DocumentOverlay>
  )
}
