import type { Document } from '@/types'

/**
 * How a Document is presented to a student. Pure and free of `server-only`
 * so both the server page and the client accordion can branch on it.
 */
export type DocumentViewKind =
  /** A published editor document with a snapshot — rendered live (#67). */
  | 'interactive'
  /**
   * A Lernseite (#107) — prose, formulas and worked examples, rendered by
   * `LessonView`. A `lesson` row with no `content` is a page an author created
   * and has not written yet; it falls back to `picture`, which for a row with
   * no file at all renders as the same honest nothing the accordion already
   * shows. There is no PNG behind a lesson and there is not meant to be.
   */
  | 'lesson'
  /** The stored picture: a legacy `image`, or an interactive row whose snapshot is missing. */
  | 'picture'
  /** A legacy image collection — its `document_images`, in order. */
  | 'collection'
  /** A legacy PDF — opened through the signed-file proxy. */
  | 'file'

/**
 * Document kinds whose file `updateDocument` refuses to replace — and which
 * the admin form must therefore not offer an upload for (#86).
 *
 * ONE LIST, TWO CALLERS. It used to be spelled out in both
 * `actions/admin/documents.ts` and `DocumentForm.tsx` with a comment asking
 * that they be kept in step; they now read the same constant, because the
 * failure mode of drift is silent — the form offers an upload the action
 * discards while reporting success.
 *
 * - `image_collection`: its pages are uploaded as a set.
 * - `interactive`: its file IS the published PNG of an editor draft. Replacing
 *   it would flip `file_type` away while the content JSON and the re-homed
 *   images stayed behind — a row that disagrees with itself.
 * - `lesson` (#107): has no file at all; it IS its `content`. An upload would
 *   invent a file, retype the row and strand a written page.
 *
 * This module is `server-only`-free on purpose, which is what lets both the
 * server action and the client form import it.
 */
export const METADATA_ONLY_FILE_TYPES: ReadonlySet<Document['file_type']> = new Set([
  'image_collection',
  'interactive',
  'lesson',
])

/**
 * The single place the "which render path?" question is answered.
 *
 * `file_type` decides first and `content` only ever refines the interactive
 * case, so a legacy row can never fall into the live path by accident. The
 * interactive → picture fallback here is the STORED one (no snapshot was
 * written); the runtime one — a snapshot this build cannot render — lives
 * inside `InteractiveDocument`, which is the only place that can discover it.
 */
export function documentViewKind(
  doc: Pick<Document, 'file_type'> & { content?: unknown }
): DocumentViewKind {
  switch (doc.file_type) {
    case 'image_collection':
      return 'collection'
    case 'interactive':
      return doc.content != null ? 'interactive' : 'picture'
    case 'lesson':
      return doc.content != null ? 'lesson' : 'picture'
    case 'image':
      return 'picture'
    default:
      return 'file'
  }
}
