/**
 * backlinks — what points at a Dokument, scanned on demand (#75, spec #63 §6).
 *
 * An author is warned before the two operations that can break a cross-document
 * link: **deleting** a Dokument something links to, and publishing „Als neues
 * Dokument", which mints a fresh Document and re-links the draft while inbound
 * links keep pointing at the one left behind.
 *
 * ⚠ NOTHING ABOUT LINKS IS PERSISTED. There is no links table and no index —
 * this is a scan across parsed content, run at the moment the warning is
 * needed. A publish-written table was rejected twice over: it drifts the
 * instant anything writes content outside the publish path, and it is blind to
 * links sitting in unpublished DRAFTS, which is exactly where a break is
 * cheapest to catch. The accepted cost is that this does not scale
 * indefinitely and there is no standing catalogue-wide broken-link report; at
 * tens of documents with one admin and occasional deletes, that is the right
 * trade, and a links table is the growth path if it ever gets slow.
 *
 * Pure module: it is handed already-parsed content and returns plain data, so
 * every awkward case — a link buried in a styled group inside a list item, an
 * anchor-qualified link, a Kurs whose id equals the document's — is pinned by
 * unit tests rather than by a database round trip. The DB query is a thin
 * shell (`getBacklinkScanRows` in dal.ts) and the parse happens in the action.
 */

import type { EditorDocumentBlock, InlineNode, LatestEditorDocumentJson } from './document-json'
import type { LinkNode } from './links'

/**
 * Where a scanned link lives. The distinction is the point of the scan: a
 * `published` source breaks for students, a `draft` one breaks for the author
 * before anyone else ever sees it.
 */
export type BacklinkSourceKind = 'published' | 'draft'

/** One document to scan, already parsed and upgraded to the newest version. */
export interface BacklinkCandidate {
  kind: BacklinkSourceKind
  /** `documents.id` for a published snapshot, `editor_documents.id` for a draft. */
  id: string
  title: string
  content: LatestEditorDocumentJson
}

/** One document that links to the scanned target. */
export interface Backlink {
  kind: BacklinkSourceKind
  id: string
  title: string
  /** How many chips in this source point at the target — at least 1. */
  count: number
}

/**
 * The answer a scan gives: what points here, and how much of the catalogue it
 * was actually able to look at.
 *
 * ⚠ `unreadable` is not bookkeeping. A snapshot whose stored content this
 * build cannot parse might hold a link, and dropping it silently would turn
 * „could not check" into „nothing links here" — the same mistake #74 had to
 * correct on the resolver, where a failed read was reported as a missing
 * target. It should be 0 in practice (publish refuses an unreadable draft, and
 * legacy rows carry no content at all), which is exactly why a non-zero value
 * deserves to be said out loud rather than averaged away.
 */
export interface BacklinkScan {
  links: Backlink[]
  unreadable: number
}

/**
 * Every candidate holding at least one link to `docId`, in the order handed in
 * — published sources first, drafts after, each group by title
 * (`getBacklinkScanRows`).
 *
 * Both whole-document links (`{ docId }`) and anchor-qualified ones
 * (`{ docId, anchorId }`) count, because both stop resolving when the document
 * goes away — the Sprungmarke is a spot INSIDE the target, not a target of its
 * own. A `{ kursId }` or `{ unitId }` carrying the same string does NOT count:
 * the key IS the kind (links.ts), so a target cannot claim one kind and carry
 * another's id.
 *
 * ⚠ A PUBLISHED candidate whose own id is the target is skipped, and it is
 * right on BOTH paths for different reasons. On delete it goes away too, so a
 * link inside it breaks nothing that will still exist. On „Als neues Dokument"
 * it survives untouched — and so does its self-link, which keeps resolving to
 * the document it is written in. Neither is worth a warning.
 *
 * A DRAFT is never skipped, even the one whose publish produced the document.
 * It survives the delete, so its link genuinely rots — and on „Als neues
 * Dokument" it is the case that matters most, because the draft's own links to
 * the OLD document get copied into the new one verbatim.
 */
export function findDocumentBacklinks(
  candidates: readonly BacklinkCandidate[],
  docId: string
): Backlink[] {
  const out: Backlink[] = []
  for (const candidate of candidates) {
    if (candidate.kind === 'published' && candidate.id === docId) continue
    const count = countLinksToDocument(candidate.content, docId)
    if (count === 0) continue
    out.push({ kind: candidate.kind, id: candidate.id, title: candidate.title, count })
  }
  return out
}

// ── The walk ────────────────────────────────────────────────────────────────

/** Link chips in one document that address `docId`, anchored or not. */
function countLinksToDocument(doc: LatestEditorDocumentJson, docId: string): number {
  let count = 0
  for (const block of doc.content) {
    for (const node of blockInlineNodes(block)) {
      count += countInInline(node, docId)
    }
  }
  return count
}

/**
 * The inline nodes one block holds, flattened one level.
 *
 * Every shape the schema admits is enumerated here rather than probed for a
 * `children` key, so a block type added to document-json.ts fails the
 * exhaustiveness check below instead of silently going unscanned — an
 * unscanned block is a link the warning misses.
 *
 * ⚠ THIS RESTATES BLOCK SHAPE KNOWLEDGE document-json.ts ALREADY HAS (its
 * `createBlock` walks the same four inline-bearing shapes), and it stays
 * duplicated deliberately. This module is imported by the admin tree and the
 * ExportBar — both CLIENT components — and it reaches document-json.ts for
 * TYPES ONLY, so nothing of the Zod schemas, the importer or the DOM builder
 * ends up in their bundle. Sharing a runtime helper would pull all of it
 * across for four `??`-expressions. The `never` guard below is what keeps the
 * duplication honest: a new block type is a compile error here, not a silent
 * gap.
 */
function blockInlineNodes(block: EditorDocumentBlock): InlineNode[] {
  switch (block.type) {
    case 'paragraph':
    case 'heading':
      return block.children ?? []
    case 'list':
      // A list item is either a bare inline array or `{ children?, text? }`
      // (reference parity, document-json.ts `ListItemSchema`).
      return (block.items ?? []).flatMap((item) =>
        Array.isArray(item) ? item : (item.children ?? [])
      )
    case 'formula': {
      // A caption is a plain string or `{ children?, text? }`; only the object
      // form can hold nodes.
      const caption = block.caption
      if (typeof caption !== 'object' || caption === null) return []
      return caption.children ?? []
    }
    case 'code':
    case 'image':
      // No inline content at all — nothing can hide here.
      return []
    default: {
      const exhaustive: never = block
      return exhaustive
    }
  }
}

/** Matching links at and below one inline node — `{ children }` groups nest. */
function countInInline(node: InlineNode, docId: string): number {
  if (typeof node !== 'object' || node === null) return 0
  if (isLinkNode(node)) {
    const { target } = node
    return 'docId' in target && target.docId === docId ? 1 : 0
  }
  if ('children' in node && Array.isArray(node.children)) {
    let count = 0
    for (const child of node.children as InlineNode[]) count += countInInline(child, docId)
    return count
  }
  return 0
}

/**
 * A link node, told apart from the other tagged inline shape (`{ type: 'br' }`)
 * by its discriminator. The parse has already validated the payload, so the
 * tag is enough.
 */
function isLinkNode(node: Exclude<InlineNode, string | number>): node is LinkNode {
  return 'type' in node && node.type === 'link'
}

// ── The warnings ────────────────────────────────────────────────────────────

/**
 * What deleting this Dokument would cost, or `null` when nothing points at it
 * and the whole catalogue was readable.
 *
 * `null` is load-bearing: deleting an unlinked Dokument must keep exactly the
 * friction it had before this feature — one plain confirm, no extra sentence
 * about a check that found nothing.
 */
export function backlinkDeleteWarning(scan: BacklinkScan): string | null {
  const total = totalReferences(scan.links)
  const lead =
    total === 1
      ? '⚠ 1 Verweis zeigt auf dieses Dokument und würde ins Leere zeigen:'
      : `⚠ ${total} Verweise zeigen auf dieses Dokument und würden ins Leere zeigen:`
  return composeWarning(scan, lead)
}

/**
 * What „Als neues Dokument" would cost, or `null` when nothing points at the
 * document being left behind.
 *
 * Deliberately a different sentence from the delete warning: nothing breaks
 * here. The old Document stays alive and readable — it simply stops being the
 * one the draft updates, so every inbound link quietly keeps showing the
 * version the author has moved on from. That is the failure worth naming.
 */
export function backlinkRepublishWarning(scan: BacklinkScan): string | null {
  const total = totalReferences(scan.links)
  const lead =
    total === 1
      ? '⚠ 1 Verweis zeigt auf das bisherige Dokument. Er zeigt weiterhin dorthin und nicht auf das neue:'
      : `⚠ ${total} Verweise zeigen auf das bisherige Dokument. Sie zeigen weiterhin dorthin und nicht auf das neue:`
  return composeWarning(scan, lead)
}

/**
 * Lead sentence + the sources it introduces + whatever the scan could not
 * read. A scan that found nothing but could not read everything still speaks:
 * the caveat alone is the whole warning.
 */
function composeWarning(scan: BacklinkScan, lead: string): string | null {
  const parts: string[] = []
  if (scan.links.length > 0) parts.push(lead, describeBacklinkSources(scan.links))
  const caveat = unreadableCaveat(scan.unreadable)
  if (caveat) parts.push(caveat)
  return parts.length === 0 ? null : parts.join('\n\n')
}

/**
 * What to say instead when the scan itself did not run — the whole query
 * failed, or the call never came back.
 *
 * ⚠ NEVER `null`. The two call sites both treat „no warning" as „go ahead
 * quietly", so a failed scan that returned nothing would read as „nothing
 * links here" — the precise confusion this feature exists to prevent, and the
 * one #74 had to correct on the resolver route. It says so instead, and lets
 * the admin decide.
 *
 * `subject` names the document in the caller's own terms, because the two
 * paths mean different things by it: the one about to be deleted, and the one
 * about to be left behind.
 */
export function backlinkScanFailedWarning(
  subject: 'dieses Dokument' | 'das bisherige Dokument' | 'diese Lernseite',
  error?: string
): string {
  const reason = error ? ` (${error})` : ''
  return `⚠ Die Verweis-Prüfung ist fehlgeschlagen${reason} — ob etwas auf ${subject} verweist, ist unbekannt.`
}

/** One bullet per source: its name, whether it is live, and how many chips. */
function describeBacklinkSources(links: readonly Backlink[]): string {
  return links.map((link) => `• „${link.title}" (${sourceNote(link)})`).join('\n')
}

/** Says what the scan could not see, so silence is never mistaken for proof. */
function unreadableCaveat(unreadable: number): string | null {
  if (unreadable <= 0) return null
  return unreadable === 1
    ? '⚠ 1 Dokument konnte nicht gelesen und daher nicht geprüft werden — es könnte ebenfalls hierher verweisen.'
    : `⚠ ${unreadable} Dokumente konnten nicht gelesen und daher nicht geprüft werden — sie könnten ebenfalls hierher verweisen.`
}

/** `veröffentlicht` / `Entwurf`, plus the count when a source holds several. */
function sourceNote(link: Backlink): string {
  const where = link.kind === 'published' ? 'veröffentlicht' : 'Entwurf'
  return link.count === 1 ? where : `${where}, ${link.count} Verweise`
}

function totalReferences(links: readonly Backlink[]): number {
  return links.reduce((sum, link) => sum + link.count, 0)
}
