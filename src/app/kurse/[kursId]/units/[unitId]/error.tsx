'use client'

export default function UnitError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="py-16 text-center">
      <h2 className="text-xl font-semibold text-gray-900">This unit could not be loaded.</h2>
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
