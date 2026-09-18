/**
 * document-version — upgrade-on-read for the versioned document JSON (#64).
 *
 * The document schema is a discriminated union over `version`
 * (document-json.ts). This module is the other half: a pure vN→vN+1 chain
 * that lifts a stored snapshot from whatever version it carries to the newest
 * version this build understands, and `readDocumentJson`, the single boundary
 * every stored snapshot passes through.
 *
 * Two rules make this module worth its own seam:
 *
 * 1. **Honest failure.** A snapshot whose version is unrecognised, or whose
 *    upgrade throws, is REFUSED — never partially accepted, never silently
 *    coerced. For paid material, dropping a node the student paid for with no
 *    indication is worse than failing loudly: the caller can fall back to the
 *    stored PNG, which it cannot do if it was handed a document that merely
 *    looks complete. `readDocumentJson` therefore returns a result union with
 *    no `doc` on the failure branch, rather than throwing or repairing.
 *
 * 2. **Purity.** Every step is a plain value→value function: no DOM, no
 *    MathJax, no server imports, no mutation of its input. That is what makes
 *    the chain unit-testable and what lets it run identically in the editor,
 *    in a server action and in the student renderer.
 *
 * Adding a version: append it to `DOCUMENT_JSON_VERSIONS`, add its schema to
 * the union, move `LATEST_DOCUMENT_JSON_VERSION`, then add its step below.
 * `DOCUMENT_JSON_UPGRADES` is a TOTAL record over the version list, so the
 * compiler refuses a half-done addition — the newest version keeps the
 * identity step, every older one returns the next version's shape.
 */

import {
  DocumentJsonSchema,
  LATEST_DOCUMENT_JSON_VERSION,
  describeDocumentJsonError,
  type DocumentJsonVersion,
  type EditorDocumentJson,
  type LatestEditorDocumentJson,
} from './document-json'

/** One rung of the ladder: a snapshot at version N → the same document at N+1. */
type UpgradeStep = (doc: EditorDocumentJson) => EditorDocumentJson

/**
 * The vN→vN+1 chain, keyed by the version being upgraded FROM. Total over
 * {@link DOCUMENT_JSON_VERSIONS}: the newest version maps to identity (there
 * is nothing above it), every older version returns the next version's shape.
 *
 * Steps must be pure and must not mutate their input — `upgradeDocumentJson`
 * relies on that to keep the caller's document intact.
 */
export const DOCUMENT_JSON_UPGRADES: Record<DocumentJsonVersion, UpgradeStep> = {
  /**
   * 1.0 → 1.1 (#71): v1.1 only ADDED the optional block-level anchor, so a
   * v1.0 document is already a valid v1.1 document — the step is a version
   * bump over an untouched body, and it deliberately invents no anchors.
   *
   * Spread-then-override rather than a rebuild, so `version` keeps its leading
   * position in the key order: publishing stores this very object.
   */
  '1.0': (doc) => ({ ...doc, version: '1.1' }),
  /** Identity — 1.1 is the newest version this build understands. */
  '1.1': (doc) => doc,
}

/** Anything the chain walker needs to see: a document carrying a version. */
interface VersionedDocument {
  version: string
}

/**
 * Walks a document up an upgrade ladder until a step declines to advance it.
 *
 * The identity step is what TERMINATES this loop, which is the point: it is
 * load-bearing rather than decorative, so the totality of the step record is
 * checked at runtime on every read, and a version whose step is missing
 * cannot slip through as "already newest".
 *
 * Generic over the document shape and taking its ladder as a parameter, so
 * the chain can be tested across a real vN→vN+1 hop while only one version
 * exists in production. {@link upgradeDocumentJson} is the real entry point.
 */
export function upgradeThroughChain<T extends VersionedDocument>(
  doc: T,
  steps: Record<string, ((doc: T) => T) | undefined>,
  latest: string
): T {
  let current = doc
  // Every step must move strictly up the ladder, so the loop can run at most
  // once per version — the bound just turns a malformed chain into an error
  // instead of a hang.
  for (let hops = 0; hops <= Object.keys(steps).length; hops++) {
    const version = current.version
    const step = steps[version]
    if (!step) throw new Error(`Nicht unterstützte Schema-Version: "${version}".`)

    const next = step(current)
    if (next.version === version) {
      // A step that does not advance is the identity step, and identity is
      // only correct at the top of the ladder.
      if (version === latest) return next
      throw new Error(`Aktualisierung der Schema-Version "${version}" hat die Version nicht erhöht.`)
    }
    current = next
  }
  throw new Error('Aktualisierung der Schema-Version wurde nicht abgeschlossen.')
}

/**
 * Migrates a schema-valid snapshot up to {@link LATEST_DOCUMENT_JSON_VERSION}.
 *
 * Throws a German `Error` when the version is outside the supported list, or
 * when a step fails to advance the version (a malformed chain). Callers
 * reading untrusted storage should use {@link readDocumentJson}, which turns
 * both into an honest `ok: false`.
 */
export function upgradeDocumentJson(doc: EditorDocumentJson): LatestEditorDocumentJson {
  const upgraded = upgradeThroughChain<EditorDocumentJson>(
    doc,
    DOCUMENT_JSON_UPGRADES,
    LATEST_DOCUMENT_JSON_VERSION
  )
  // Sound because the schema ties each `version` literal to its own shape: a
  // document reporting the newest version parsed as the newest union member.
  return upgraded as LatestEditorDocumentJson
}

/** Outcome of reading a stored snapshot: a usable document, or an honest refusal. */
export type DocumentJsonReadResult =
  | { ok: true; doc: LatestEditorDocumentJson }
  | { ok: false; error: string }

/**
 * The read boundary for stored document JSON — parse, then upgrade.
 *
 * `raw` is whatever came back from the database (or a file): unvalidated
 * `unknown`. On success the document is guaranteed to be at the newest
 * version and structurally complete. On failure the caller gets a German
 * message and NO document, which is the signal to fall back to the stored
 * PNG rather than render something partial.
 */
export function readDocumentJson(raw: unknown): DocumentJsonReadResult {
  const parsed = DocumentJsonSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: describeDocumentJsonError(parsed.error, raw) }
  }
  try {
    return { ok: true, doc: upgradeDocumentJson(parsed.data) }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Dokument konnte nicht aktualisiert werden.',
    }
  }
}
