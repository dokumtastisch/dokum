'use client'

import { Watermark } from './Watermark'

/**
 * The stored picture of a document, served through the signed-file proxy.
 *
 * Two callers, deliberately one implementation: it is how a legacy `image`
 * document renders, and it is the per-document runtime fallback for an
 * interactive document the app cannot render (#67). Sharing the markup is
 * what makes the fallback indistinguishable from the real thing — a student
 * hitting it sees the document, not a degraded version of it.
 */
export function DocumentPng({
  docId,
  title,
  watermarkId,
}: {
  docId: string
  title: string
  watermarkId: string
}) {
  return (
    <div className="mt-2 flex w-full justify-center">
      <div
        className="relative inline-block max-w-full overflow-hidden rounded-md"
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/file/${docId}`}
          alt={title}
          className="block max-w-full max-h-[600px] select-none"
          style={
            {
              pointerEvents: 'none',
              userSelect: 'none',
              WebkitUserDrag: 'none',
            } as React.CSSProperties
          }
          draggable={false}
        />
        <Watermark id={watermarkId} />
      </div>
    </div>
  )
}
