'use client'

/**
 * What a student is told when a Dokument fails to load, and the button that
 * retries — shared by the full page's error boundary and the overlay's.
 *
 * The two boundaries genuinely differ (one replaces the page, one keeps the
 * dialog so the close button still works) but they say the same thing, and a
 * refusal message that exists twice is a refusal message that drifts.
 */
export function DocumentErrorPanel({
  reset,
  headingId,
}: {
  reset: () => void
  /** Set by the overlay, which labels its dialog with this heading. */
  headingId?: string
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-20 text-center">
      <h2 id={headingId} className="text-xl font-semibold text-gray-900">
        This document could not be loaded.
      </h2>
      <p className="mt-2 text-sm text-gray-500">Please try again.</p>
      <button
        onClick={reset}
        className="mt-6 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors"
      >
        Try again
      </button>
    </div>
  )
}
