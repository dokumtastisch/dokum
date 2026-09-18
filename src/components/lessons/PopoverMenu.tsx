'use client'

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * A small panel that opens under a trigger — the plain replacement for the
 * Radix dropdown the editor used to import.
 *
 * ⚠ IT EXISTS BECAUSE THE COMPONENT LIBRARY DOES NOT. `radix-ui` came in with
 * the shadcn install and brought its own look; this is the behaviour the editor
 * actually needs, wearing the app's own classes and nothing else.
 *
 * The behaviour is deliberately the short list rather than a menu
 * implementation: open, close on Escape, close on a click outside, and return
 * focus to the trigger so the keyboard does not end up nowhere. There is no
 * arrow-key roving — both call sites are GRIDS (emoji, block types), where
 * up/down would move focus in directions the eye does not expect, and plain
 * Tab order is the honest answer.
 */
export function PopoverMenu({
  label,
  trigger,
  align = 'start',
  panelClassName,
  children,
}: {
  /** Accessible name of the trigger. */
  label: string
  /** Rendered inside the trigger button. */
  trigger: ReactNode
  align?: 'start' | 'end'
  panelClassName?: string
  /** Receives `close` so an item can dismiss the panel after acting. */
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return

    function onPointerDown(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setOpen(false)
      // Without this the focus would be left on a node that just disappeared,
      // and the next Tab would start over at the top of the document.
      triggerRef.current?.focus()
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={container} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center rounded-md transition-colors focus:ring-2 focus:ring-brand focus:outline-none"
      >
        {trigger}
      </button>

      {open && (
        <div
          className={`absolute top-full z-50 mt-1 rounded-xl border border-gray-200 bg-white p-1.5 shadow-[0_8px_20px_rgb(0_0_0_/_0.08)] ${
            align === 'end' ? 'right-0' : 'left-0'
          } ${panelClassName ?? ''}`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

/** The app's micro-label, as the heading of a popover panel. */
export function PopoverMenuLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-2 py-1.5 text-[10px] font-bold tracking-[0.1em] text-gray-400 uppercase">
      {children}
    </p>
  )
}
