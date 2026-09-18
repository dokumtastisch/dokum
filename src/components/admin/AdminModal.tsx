'use client'

import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

/**
 * The admin's modal shell (#108) — where a create/edit form opens instead of
 * taking over the page.
 *
 * A NATIVE `<dialog>` FOR THE SAME REASONS `DocumentOverlay` uses one: the
 * browser gives the focus trap, Escape, and an inert background for free, and
 * the top layer means no `z-index` can be got wrong. Rendering the `open`
 * attribute would NOT do that — only `showModal()` puts the element in the top
 * layer — so the effect below is what opens it.
 *
 * ⚠ CLOSING ALWAYS GOES THROUGH `onClose`. A native close (Escape, the
 * backdrop) fires the `cancel`/`close` events and would otherwise leave React's
 * state saying the dialog is open while the browser has shut it — the next
 * „open" would then do nothing at all. Every path is routed back to the same
 * callback so the two can never disagree.
 */
export function AdminModal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const pressedBackdrop = useRef(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    return () => {
      if (dialog.open) dialog.close()
    }
  }, [])

  return (
    <dialog
      ref={dialogRef}
      aria-label={title}
      // Escape and any other native dismissal must not close behind React's
      // back — hand both to the caller, which owns the state.
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClose={onClose}
      // A press that STARTS and ENDS on the dialog element itself came from the
      // backdrop: the children cover the padding box, so nothing inside can be
      // the target. Tracking both halves means a drag that begins on a text
      // field and releases outside does not dismiss the form (the exact bug
      // DocumentOverlay documents).
      onMouseDown={(event) => {
        pressedBackdrop.current = event.target === dialogRef.current
      }}
      onClick={(event) => {
        if (pressedBackdrop.current && event.target === dialogRef.current) onClose()
      }}
      className="m-auto w-[92vw] max-w-2xl rounded-xl border-0 bg-white p-0 shadow-2xl backdrop:bg-black/40"
    >
      <div className="flex max-h-[85vh] flex-col">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label="Schließen"
          >
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </dialog>
  )
}
