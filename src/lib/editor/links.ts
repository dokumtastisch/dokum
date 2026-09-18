/**
 * links — cross-document links: the inline link node and its DOM contract
 * (#72, spec #63 §6).
 *
 * A link points at a node of the hierarchy — a Kurs, an Einheit, a Dokument,
 * or a Sprungmarke inside a Dokument — and carries the label it reads as
 * inside a sentence. What it stores is the target's **published primary key**:
 *
 *     { kursId } | { unitId } | { docId } | { docId, anchorId }
 *
 * That shape is the whole design (spec §6). Because a target must already be
 * published before it can be picked, following a link is a single-row
 * primary-key fetch rather than a search — no anchor table, no index, no new
 * RLS policy. Storing a DRAFT id instead was rejected: drafts are admin-only
 * and get deleted out from under their published snapshots, so a link into one
 * would rot silently.
 *
 * **A link chip is an opaque pill, exactly like an input/output field.** It is
 * `contenteditable="false"`, its whole identity lives in its dataset, and its
 * label is its text — so the serializer reads it as ONE node and a
 * contenteditable can neither split it nor let an author edit half of it.
 * Re-targeting and relabelling therefore go through the picker, not through
 * typing, which is also why the node carries no `style`: like `{ fieldId }`, a
 * pill is styled by the group it sits in, never in itself.
 *
 * The kind icon is deliberately NOT part of the label. It is drawn by CSS from
 * `data-link-kind`, so it never enters `textContent` and can never end up
 * baked into a stored label.
 *
 * Pure DOM module: no controller state, no MathJax, no server imports. Nodes
 * are created through the passed document, so it runs in the browser and in
 * jsdom alike.
 */

import { z } from 'zod'

/**
 * What a link stores. Distinct key names rather than a `kind` discriminator,
 * matching the spec's own notation — the key IS the kind, so a target cannot
 * be built that claims one kind and carries another's id.
 *
 * `anchorId` only ever accompanies `docId`: a Sprungmarke is a spot INSIDE a
 * document, so it is meaningless without the document that holds it.
 */
export const LinkTargetSchema = z.union([
  z.strictObject({ kursId: z.string().uuid('Ungültige Kurs-Referenz.') }),
  z.strictObject({ unitId: z.string().uuid('Ungültige Einheiten-Referenz.') }),
  z.strictObject({
    docId: z.string().uuid('Ungültige Dokument-Referenz.'),
    /** Opaque Sprungmarken id (anchors.ts) — never a slug, never derived. */
    anchorId: z.string().min(1, 'Sprungmarke benötigt eine "anchorId".').optional(),
  }),
])

export type LinkTarget = z.infer<typeof LinkTargetSchema>

/**
 * The inline node — the wire shape of a link inside the document JSON.
 *
 * Composed into the v1.1 inline union by document-json.ts, and deliberately
 * NOT into v1.0: links arrived with v1.1, and admitting them into v1.0 would
 * make the version discriminator a decoration.
 *
 * Key order is part of the byte-stability contract: `type`, `target`, `label`
 * is the order the serializer emits and therefore the order a parse must
 * reproduce.
 */
export const LinkNodeSchema = z.strictObject({
  type: z.literal('link'),
  target: LinkTargetSchema,
  /** What the chip reads as in the sentence — free text the author can rewrite. */
  label: z.string(),
})

export type LinkNode = z.infer<typeof LinkNodeSchema>

/** A link without its node wrapper — what the picker returns and a chip holds. */
export interface DocumentLink {
  target: LinkTarget
  label: string
}

/** The three things a link can point at. A Task is not among them (spec §6). */
export type LinkTargetKind = 'kurs' | 'unit' | 'document'

/** Which kind of node a target addresses. */
export function linkTargetKind(target: LinkTarget): LinkTargetKind {
  if ('kursId' in target) return 'kurs'
  if ('unitId' in target) return 'unit'
  return 'document'
}

/** The primary key a target addresses, whatever kind it is. */
export function linkTargetId(target: LinkTarget): string {
  if ('kursId' in target) return target.kursId
  if ('unitId' in target) return target.unitId
  return target.docId
}

/** The Sprungmarke a target points into, or `null` — only documents have one. */
export function linkTargetAnchorId(target: LinkTarget): string | null {
  return 'docId' in target ? target.anchorId ?? null : null
}

/** Whether two targets address the same thing, Sprungmarke included. */
export function sameLinkTarget(a: LinkTarget, b: LinkTarget): boolean {
  return (
    linkTargetKind(a) === linkTargetKind(b) &&
    linkTargetId(a) === linkTargetId(b) &&
    linkTargetAnchorId(a) === linkTargetAnchorId(b)
  )
}

/** German name of a target kind — what the picker calls the thing. */
export const LINK_KIND_LABEL: Record<LinkTargetKind, string> = {
  kurs: 'Kurs',
  unit: 'Einheit',
  document: 'Dokument',
}

/**
 * The glyph that tells a reader how far a link travels, one per kind.
 *
 * ⚠ MIRRORED IN THE EDITOR'S CSS. The authoring chip draws its icon from
 * `data-link-kind` in a `::before` (editor.css, „Link-Chips"), because an icon
 * inside the chip's text would end up baked into a stored label. A
 * pseudo-element cannot read this map, so those two must be changed together.
 * The picker and the student's chip (#73) both read it from here, so the
 * editor stylesheet is the only copy.
 */
export const LINK_KIND_ICON: Record<LinkTargetKind, string> = {
  kurs: '📘',
  unit: '📗',
  document: '📄',
}

/**
 * A Sprungmarke is not a kind of its own, but it does get its own glyph.
 *
 * ⚠ It is not the only one either: a chip whose target the student has not
 * bought wears a lock instead (`lib/unreachable-links.ts`, #74). That one is
 * deliberately NOT here — it says something about the READER rather than about
 * the target, and entitlements are app knowledge this module stays free of. If
 * you are chasing „where does a chip's glyph come from", it is these two plus
 * {@link LINK_KIND_ICON}, all through `data-link-icon`.
 */
export const LINK_ANCHOR_ICON = '⚓'

/** …and its own name, for the same reason (#73). */
export const LINK_ANCHOR_LABEL = 'Sprungmarke'

/**
 * The glyph a target wears. A Sprungmarke wins over the document that holds it
 * — it is the more specific thing, and it is the one that says the link lands
 * somewhere particular rather than at the top.
 */
export function linkTargetIcon(target: LinkTarget): string {
  if (linkTargetAnchorId(target)) return LINK_ANCHOR_ICON
  return LINK_KIND_ICON[linkTargetKind(target)]
}

/**
 * What the glyph would say in words — the same four distinctions, for the
 * readers a CSS-drawn icon never reaches (#73, spec §6 user story 19).
 */
export function linkTargetKindLabel(target: LinkTarget): string {
  if (linkTargetAnchorId(target)) return LINK_ANCHOR_LABEL
  return LINK_KIND_LABEL[linkTargetKind(target)]
}

/** The class every link chip carries — the serializer's hook. */
export const LINK_CHIP_CLASS = 'doc-link'

/** Selector for link chips, mirroring the field pills' `FIELD_SELECTOR`. */
export const LINK_CHIP_SELECTOR = '.' + LINK_CHIP_CLASS

/**
 * Rebuilds a target from the three dataset attributes a chip carries, or
 * `null` when they do not describe one.
 *
 * A blank id reads as no link at all — the same rule
 * {@link import('./anchors').readBlockAnchor} applies to a blank anchor id: a
 * chip nothing can be followed to is not a link, and admitting it would put an
 * unfollowable node into the document JSON.
 */
function targetFromDataset(el: HTMLElement): LinkTarget | null {
  const id = (el.dataset['linkId'] ?? '').trim()
  if (!id) return null
  const kind = el.dataset['linkKind']
  if (kind === 'kurs') return { kursId: id }
  if (kind === 'unit') return { unitId: id }
  if (kind !== 'document') return null
  const anchorId = (el.dataset['linkAnchorId'] ?? '').trim()
  return anchorId ? { docId: id, anchorId } : { docId: id }
}

/** The link a chip holds, or `null` when the element is not a usable one. */
export function readLinkChip(el: HTMLElement): DocumentLink | null {
  const target = targetFromDataset(el)
  if (!target) return null
  return { target, label: el.textContent ?? '' }
}

/**
 * Stamps a link onto an existing chip — the re-target/relabel path. Every
 * attribute is rewritten, `data-link-anchor-id` included, so a chip
 * re-pointed from a Sprungmarke to a plain document does not keep the old one.
 */
export function writeLinkChip(el: HTMLElement, link: DocumentLink): void {
  const { target, label } = link
  el.dataset['linkKind'] = linkTargetKind(target)
  el.dataset['linkId'] = linkTargetId(target)
  const anchorId = linkTargetAnchorId(target)
  if (anchorId) el.dataset['linkAnchorId'] = anchorId
  else delete el.dataset['linkAnchorId']
  el.textContent = label
}

/**
 * A fresh link chip. `contenteditable="false"` for the same reason the field
 * pills carry it: the chip is one atom to the caret, so no keystroke can
 * separate a label from the target it names.
 */
export function createLinkChip(docEl: Document, link: DocumentLink): HTMLElement {
  const el = docEl.createElement('span')
  el.className = LINK_CHIP_CLASS
  el.setAttribute('contenteditable', 'false')
  writeLinkChip(el, link)
  return el
}

/**
 * A click on a chip that the APP should handle itself. Everything else — a
 * modifier held, the middle button — is the student asking the BROWSER for
 * something (a new tab, a new window), and intercepting it would take that
 * away.
 *
 * Lives here rather than beside either of its callers because both the live
 * chip (document-render.ts) and the locked one (lib/unreachable-links.ts)
 * intercept clicks, and a chip that answered a Ctrl-click differently
 * depending on whether its target was bought would be the strangest possible
 * inconsistency.
 */
export function isPlainLeftClick(event: MouseEvent): boolean {
  return (
    event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey
  )
}

// ── The picker seam ─────────────────────────────────────────────────────────
//
// The target tree is server data, so the picker itself is a React component —
// the one part of this feature the imperative controller cannot own. These two
// types are the whole contract between them: the controller asks, the shell
// answers, and neither knows anything else about the other.

/** What the controller hands the picker when the „Link"-button is pressed. */
export interface LinkPickRequest {
  /**
   * Text the author had selected. The default label for a NEW link, so that a
   * link reads naturally inside the sentence it was written into; empty when
   * nothing was selected, in which case the picker falls back to the target's
   * own name.
   */
  selectedText: string
  /** The link being edited, or `null` when a new one is being inserted. */
  current: DocumentLink | null
}

/**
 * What the picker answers. `null` (not a variant) means cancelled — nothing
 * about the document changes, not even the caret.
 */
export type LinkPickResult =
  | { action: 'apply'; link: DocumentLink }
  /** Unlink: the words stay in the sentence, only the link goes. */
  | { action: 'remove' }
