/**
 * publish-plan — the copy-fresh-then-swap re-homing plan for publishing an
 * editor draft as a Document (#66, spec #63 §3).
 *
 * Publishing has to move a draft's images into the student-facing world, and
 * the constraint that decides the whole design is that it must COPY, never
 * move: `editor_images` rows cascade with their draft, and the draft has to
 * stay editable and re-publishable. A published document that pointed at
 * draft images would blank out the moment its draft was deleted.
 *
 * The ordering IS the guarantee, and it is the ordering the publish action
 * already uses for the PNG:
 *
 *   1. copy the referenced draft images to fresh document-image paths
 *   2. insert the document-image rows
 *   3. rewrite the snapshot's image references to those rows
 *   4. update the Document row — content + file path — in ONE statement
 *   5. delete the PREVIOUS publish's rows and objects
 *
 * Fail before step 4 and only orphans exist while the live document is
 * untouched; fail at step 5 and only stale objects remain while the document
 * is correct. Never the other way round.
 *
 * This module is the pure half: it decides what to copy, which references to
 * rewrite and what to delete, and it decides all of it BEFORE anything is
 * touched — which is what makes the ordering testable without storage. The
 * document-image ids are minted here rather than left to the database default
 * precisely so the rewrite can happen up front, in one pass, with no
 * round-trip in the middle.
 *
 * Pure module: no Supabase, no DOM, no mutation of its input.
 */

import { collectReferencedImageIds, type LatestEditorDocumentJson } from './document-json'

/** An `editor_images` row of the draft being published. */
export interface DraftImageRef {
  id: string
  file_path: string
}

/** A `document_images` row of the target Document — the previous publish's copies. */
export interface StoredImageRef {
  id: string
  file_path: string
}

/** One draft image and the fresh copy it becomes. */
export interface PlannedImageCopy {
  /** The `editor_images` row copied FROM — never modified, never deleted. */
  draftImageId: string
  /** The `document_images` row id the copy will be inserted with. */
  documentImageId: string
  fromPath: string
  toPath: string
  position: number
}

export interface PublishPlan {
  /** Storage objects to copy, before anything else happens. */
  copies: PlannedImageCopy[]
  /** `document_images` rows to insert once the copies exist, in content order. */
  inserts: { id: string; file_path: string; position: number }[]
  /** The snapshot to store: every draft image id rewritten to its copy. */
  content: LatestEditorDocumentJson
  /**
   * The PREVIOUS publish's rows and objects. Deleted only AFTER the Document
   * update succeeds — never the draft's own images (copy-not-move), never a
   * freshly copied object.
   */
  stale: { imageIds: string[]; paths: string[] }
}

export type PublishPlanResult = { ok: true; plan: PublishPlan } | { ok: false; error: string }

export interface PublishPlanInput {
  /** The draft's saved snapshot, already parsed and upgraded to the newest version. */
  content: LatestEditorDocumentJson
  /** Every `editor_images` row of the draft. Unreferenced ones are ignored. */
  draftImages: DraftImageRef[]
  /** Every `document_images` row of the target Document; empty on a first publish. */
  previousImages: StoredImageRef[]
  /** Mints the id a copied image's `document_images` row will carry. */
  mintImageId: () => string
  /** Mints the storage path a copied image is written to. */
  mintImagePath: (source: { draftImageId: string; fromPath: string; index: number }) => string
}

/**
 * Decides everything a publish must do to the images, before it does any of
 * it. Returns an honest refusal — and no plan — when the snapshot references
 * an image the draft does not have: publishing a document whose picture
 * cannot be re-homed would hand a student a broken image, which is worse
 * than not publishing at all.
 */
export function planPublish(input: PublishPlanInput): PublishPlanResult {
  const { content, draftImages, previousImages, mintImageId, mintImagePath } = input

  const byDraftImageId = new Map(draftImages.map((img) => [img.id, img]))
  const referenced = collectReferencedImageIds(content)

  const copies: PlannedImageCopy[] = []
  // Draft image id → the document-image id its blocks are rewritten to. Built
  // from the deduped reference list, so an image used twice is copied once and
  // both blocks land on the same row.
  const rewrites = new Map<string, string>()

  for (const [index, draftImageId] of referenced.entries()) {
    const draftImage = byDraftImageId.get(draftImageId)
    if (!draftImage) {
      return {
        ok: false,
        error:
          `Das Dokument verweist auf ein Bild, das nicht mehr zum Entwurf gehört (${draftImageId}). ` +
          'Bitte das Bild erneut einfügen und den Entwurf speichern.',
      }
    }
    const documentImageId = mintImageId()
    copies.push({
      draftImageId,
      documentImageId,
      fromPath: draftImage.file_path,
      toPath: mintImagePath({ draftImageId, fromPath: draftImage.file_path, index }),
      position: index,
    })
    rewrites.set(draftImageId, documentImageId)
  }

  return {
    ok: true,
    plan: {
      copies,
      inserts: copies.map((c) => ({ id: c.documentImageId, file_path: c.toPath, position: c.position })),
      content: rewriteImageReferences(content, rewrites),
      stale: {
        imageIds: previousImages.map((img) => img.id),
        paths: previousImages.map((img) => img.file_path),
      },
    },
  }
}

/**
 * Replaces every image block's `imageId` with its re-homed counterpart.
 *
 * Spreads the block rather than rebuilding it, so the emitted key order is
 * unchanged — the serializer's export → import → export byte-stability
 * contract has to keep holding for the stored snapshot too.
 */
function rewriteImageReferences(
  content: LatestEditorDocumentJson,
  rewrites: Map<string, string>
): LatestEditorDocumentJson {
  if (rewrites.size === 0) return content
  return {
    ...content,
    content: content.content.map((block) => {
      if (block.type !== 'image') return block
      const documentImageId = rewrites.get(block.imageId)
      return documentImageId ? { ...block, imageId: documentImageId } : block
    }),
  }
}
