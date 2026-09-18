'use client'

import { createContext, useCallback, useContext, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'

/**
 * The channel from the Kurs sidebar to the Einheit's accordion (#106).
 *
 * WHY A CHANNEL AND NOT A LINK. Clicking a Dokument in the tree does not open
 * anything — it goes to the copy already rendered in the main column: the
 * accordion unfolds the owning Aufgabe and scrolls the Dokument into view. That
 * cannot be a URL, because nothing navigates; and it cannot be a prop, because
 * the sidebar lives in the Kurs LAYOUT and the accordion lives in the PAGE the
 * layout wraps. Sibling route subtrees have no way to reach each other except
 * through something the layout puts around both of them.
 *
 * THE HANDLER LIVES IN A REF, NOT IN STATE, and that is what keeps this cheap:
 * the accordion registers itself on mount, and registration must not re-render
 * the layout, the sidebar, or anything else. `value` is memoised to nothing, so
 * the context never changes identity for the whole life of the Kurs shell.
 *
 * `reveal()` is a no-op when no accordion is mounted — on the Kurs landing page,
 * or on a paywalled Einheit. That is not a case worth guarding against: only the
 * Einheit currently on screen is unfolded in the tree, so the Dokumente the
 * student can click are the ones the mounted accordion holds.
 */
interface DocumentRevealApi {
  /** Called by the accordion on mount; returns the unregister function. */
  register: (handler: (docId: string) => void) => () => void
  /** Called by the sidebar: bring this Dokument into view in the main column. */
  reveal: (docId: string) => void
}

const DocumentRevealContext = createContext<DocumentRevealApi | null>(null)

export function DocumentRevealProvider({ children }: { children: ReactNode }) {
  const handler = useRef<((docId: string) => void) | null>(null)

  const value = useMemo<DocumentRevealApi>(
    () => ({
      register(next) {
        handler.current = next
        return () => {
          // Only clear if this registration is still the live one — a fast
          // navigation can mount the next accordion before the old one's
          // cleanup runs, and a blind reset would erase the newcomer.
          if (handler.current === next) handler.current = null
        }
      },
      reveal(docId) {
        handler.current?.(docId)
      },
    }),
    []
  )

  return <DocumentRevealContext.Provider value={value}>{children}</DocumentRevealContext.Provider>
}

/** The sidebar's half. Outside the provider this returns a no-op. */
export function useRevealDocument(): (docId: string) => void {
  const api = useContext(DocumentRevealContext)
  return useCallback((docId: string) => api?.reveal(docId), [api])
}

/** The accordion's half — pass the handler that unfolds and scrolls. */
export function useRegisterDocumentReveal(): DocumentRevealApi['register'] {
  const api = useContext(DocumentRevealContext)
  return useCallback((handler: (docId: string) => void) => api?.register(handler) ?? noop, [api])
}

function noop() {}
