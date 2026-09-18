'use client'

import { useEffect, useRef } from 'react'
import UnitPaywall from '@/components/kurse/UnitPaywall'
import type { LockedLinkTarget } from '@/lib/link-target-state'

/**
 * What a link into material the student has not bought opens (#74, spec #63
 * user story 21): the Einheit it lives in, the teaser that describes it, and
 * the button that unlocks it.
 *
 * ⚠ THE POINT IS THAT IT OPENS IN PLACE. Following the link would land on the
 * same refusal any unentitled read gets, and — worse for a document full of
 * live inputs — unmount everything the student has typed on the way. So the
 * chip does not navigate: it hands the descriptor the resolver returned to
 * React, and React puts this on top. Nothing is fetched here; the card renders
 * from what the resolver already said.
 *
 * The offer itself is {@link UnitPaywall}, the SAME component the locked
 * Einheit page shows, rather than a second copy of the unlock UI. A student who
 * meets the paywall through a link and one who meets it by opening the Einheit
 * see the same words and the same price, and the Einheit's teaser reaches both
 * surfaces by construction instead of by two people remembering to update it.
 *
 * A native `<dialog>` for the same reasons as the document overlay: a real
 * focus trap, Escape, and an inert background from the platform. Unlike that
 * overlay this pushes NO history entry — nothing about the URL changes when a
 * card opens — so closing it is ordinary `close()` and browser Back still means
 * „leave the document", which is what a student who never opened a card
 * expects too.
 */
export function LinkLockedCard({
  target,
  onDismiss,
}: {
  target: LockedLinkTarget
  onDismiss: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const pressedBackdrop = useRef(false)
  const titleId = `link-locked-${target.unit.id}`

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    // Remembered before `showModal()` moves focus off it: the chip that opened
    // the card is still in the document underneath, and a keyboard user has to
    // come back to their place in the sentence rather than to `<body>`.
    const opener = document.activeElement
    if (!dialog.open) dialog.showModal()

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
      if (dialog.open) dialog.close()
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])

  // EVERY dismissal goes through the element's own `close()`, so Escape (which
  // closes natively) and the two buttons cannot end up in different states —
  // React unmounts the card from the one `onClose` all of them produce.
  const dismiss = () => dialogRef.current?.close()

  return (
    <dialog
      ref={dialogRef}
      // `aria-labelledby` wins whenever it resolves; the static label is the
      // net under it, so a state that failed to render the line below degrades
      // to a vaguely-named dialog rather than an unnamed one (DocumentOverlay
      // carries the same pair for the same reason).
      aria-label="Unit locked"
      aria-labelledby={titleId}
      onClose={onDismiss}
      // The press decides, not the click: a click's target is the common
      // ancestor of press and release, so releasing past the panel edge after
      // selecting text inside it would otherwise dismiss the card.
      onMouseDown={(event) => {
        pressedBackdrop.current = event.target === dialogRef.current
      }}
      onClick={(event) => {
        if (pressedBackdrop.current && event.target === dialogRef.current) dismiss()
      }}
      className="m-auto w-[92vw] max-w-lg rounded-xl border-0 bg-transparent p-0 backdrop:bg-black/40"
    >
      <div className="rounded-xl bg-[#fffdf8] p-1 shadow-2xl">
        <div className="flex justify-end px-3 pt-2">
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss notice"
            className="rounded-md px-2 py-1 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
          >
            Close ✕
          </button>
        </div>
        <p id={titleId} className="px-6 text-sm text-gray-600">
          The linked document{' '}
          <span className="font-medium text-gray-900">{target.title}</span> belongs to a unit you
          have not unlocked yet.
        </p>
        {/* `mt-8` on the paywall's own box is the spacing below this line. */}
        <UnitPaywall
          unitId={target.unit.id}
          title={target.unit.title}
          description={target.unit.description}
          kursId={target.unit.kursId}
          kursTitle={target.unit.kursTitle}
          soldAs={target.unit.soldAs}
          kursPriceCents={target.unit.kursPriceCents}
        />
        <div className="h-4" />
      </div>
    </dialog>
  )
}
