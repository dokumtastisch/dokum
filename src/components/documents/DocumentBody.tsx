'use client'

import type { RenderableDocument } from '@/types'
import { documentViewKind } from '@/lib/document-view'
import { DocumentPng } from './DocumentPng'
import { InteractiveDocument } from './InteractiveDocument'
import { Watermark } from './Watermark'

/**
 * A document's body — everything below its title — for every `file_type`
 * there is.
 *
 * Two surfaces render documents: the Unit accordion and the addressable
 * full-page route (#69). They differ in their chrome (heading size, the way
 * back, the URL) and in nothing else, so the body lives here once. That is
 * what keeps "one content type, one render path" (#63) true in the code and
 * not merely on the student's screen — a new node type or a changed fallback
 * lands on both surfaces or on neither.
 *
 * The caller supplies the heading and the surrounding layout, because the two
 * surfaces genuinely disagree about them: a PDF row in the accordion puts its
 * small button beside the title, while the full page stacks everything at page
 * scale. Nothing here carries a size or a flex class for that reason — the
 * PDF button inherits its font size from whichever surface renders it.
 */
export function DocumentBody({
  doc,
  watermarkId,
}: {
  doc: RenderableDocument
  watermarkId: string
}) {
  switch (documentViewKind(doc)) {
    case 'interactive':
      // A published editor document renders LIVE (#67): real text, typeset
      // formulas, resolved values, inputs the student can change (#68). The
      // dual-written PNG stays as the per-document runtime fallback, handled
      // inside InteractiveDocument.
      return (
        <InteractiveDocument
          docId={doc.id}
          title={doc.title}
          content={doc.content}
          watermarkId={watermarkId}
        />
      )

    case 'picture':
      // A legacy image document, and an interactive one whose snapshot was
      // never stored — both are just the picture.
      return <DocumentPng docId={doc.id} title={doc.title} watermarkId={watermarkId} />

    case 'collection':
      return (
        <div className="mt-2 grid grid-cols-1 gap-2">
          {(doc.document_images ?? []).map((img) => (
            <div key={img.id} className="mt-1 flex w-full justify-center">
              <div
                className="relative inline-block rounded-md overflow-hidden max-w-full"
                onContextMenu={(e) => e.preventDefault()}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/image/${img.id}`}
                  alt={doc.title}
                  className="block max-w-full max-h-[400px] select-none"
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
          ))}
        </div>
      )

    case 'file':
      return (
        <a
          href={`/api/file/${doc.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block rounded-md border border-brand px-3 py-1.5 font-medium text-brand hover:bg-brand/5 transition-colors btn-brand"
        >
          Open PDF ↗
        </a>
      )
  }
}
