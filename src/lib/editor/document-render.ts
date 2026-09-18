/**
 * document-render — the student-facing renderer for published document JSON
 * (#67, spec #63 §4).
 *
 * This is the payoff of not flattening documents to a picture: a published
 * snapshot renders as live content — real selectable text, crisply typeset
 * formulas, images, and computed values — instead of a PNG.
 *
 * It is Option B of the structure decision: a dedicated renderer that REUSES
 * the editor's already-pure modules rather than mounting the imperative
 * controller read-only. Concretely it reuses the JSON importer (which already
 * knows every v1.0 block and inline shape, including the field-pill clones and
 * reference resolution), the field resolver, the expression evaluator, the
 * LaTeX normaliser and the German number formatter — so the student sees the
 * same document the author built, resolved by the same code.
 *
 * ⚠ ONE THING IS DUPLICATED, KNOWINGLY: {@link domFieldGraph} mirrors the
 * controller's DOM adapter (controller.ts, `fieldGraph`/`tokenizeLine`/
 * `toFieldData`) almost line for line. The two roots differ — the controller
 * owns a live contenteditable, this owns a read-only container — and folding
 * them together means editing the shipped editor, whose behaviour is pinned
 * by parity goldens. It was left duplicated deliberately, but it IS a second
 * implementation: a change to either adapter must be mirrored in the other,
 * or the editor and the student view will resolve the same document
 * differently. Extracting the shared adapter is the right follow-up.
 *
 * Three deliberate properties:
 *
 * 1. **MathJax-free, therefore jsdom-testable.** Like document-json.ts, this
 *    module builds DOM and stops. The formula elements come back in
 *    {@link DocumentRenderResult.renderTargets} carrying their RESOLVED LaTeX,
 *    and the React layer typesets them with the bundled loader. No CDN, no
 *    `eval`, no CSP change — the renderer needs none of it.
 *
 * 2. **Editor chrome never reaches the student.** The importer builds editor
 *    DOM: drag handles, image delete buttons, `draggable` blocks and an
 *    editable caption. All of it is stripped after the import, in one pass, so
 *    the two paths cannot drift — a new affordance added to the importer is
 *    removed here by class, not by having remembered to.
 *
 * 3. **The document is interactive, not merely live** (#68). Visible static
 *    inputs become controls the student can type into, and every dependent
 *    value re-resolves through {@link resolveDocument} — the same single pass
 *    the first render uses, so an edit lands on exactly the document a fresh
 *    render of that value would have produced. Nothing a student types is
 *    persisted anywhere: this module writes to the rendered DOM and to nothing
 *    else, and the snapshot it was handed is never touched.
 *
 * The hidden field store the importer creates is KEPT (it is `display:none`):
 * it holds the field masters the resolver reads, and it is what those controls
 * recompute against.
 *
 * ⚠ This module is therefore the SECOND imperative surface in the codebase.
 * `/admin/editor` was the first and CLAUDE.md's editor invariant is written
 * about it, but the same rule binds here for the same reason: React mounts the
 * host and must never reconcile inside it, because the DOM below holds the
 * student's own typing and the resolved state of every value that depends on
 * it. The React layer's only job is to typeset what {@link
 * DocumentRenderAdapters.onRecompute} hands back.
 *
 * Otherwise pure: no MathJax, no server imports, no mutation of the snapshot.
 * DOM is created through the container's `ownerDocument`, so it runs in the
 * browser and in jsdom alike.
 */

import { importEditorJson, type LatestEditorDocumentJson } from './document-json'
import {
  fieldDisplay,
  resolveFieldPlaceholders,
  type FieldData,
  type FieldDisplay,
  type FieldGraph,
  type LineToken,
} from './field-resolver'
import {
  LINK_CHIP_SELECTOR,
  isPlainLeftClick,
  linkTargetIcon,
  linkTargetKindLabel,
  readLinkChip,
  type DocumentLink,
  type LinkTarget,
} from './links'
import { formatGermanEntry, formatValue, parseGermanEntry } from './number-format'

export interface DocumentRenderAdapters {
  /**
   * Browser URL for a re-homed document image. The caller passes the
   * entitlement-gated `/api/image/[imageId]` route — publishing rewrote the
   * snapshot's ids to `document_images` rows (#66), so no new access path is
   * needed.
   */
  imageUrl(imageId: string): string
  /**
   * Browser URL for a link target (#73). REQUIRED, not optional: a chip with no
   * href is a dead end in the middle of a sentence, and making it optional
   * would let a surface ship one by forgetting a line. Where a link goes is app
   * knowledge, so it is injected rather than derived here.
   */
  linkHref(target: LinkTarget): string
  /**
   * Follows a link WITHOUT leaving the page, when the caller can (#73). It
   * exists because the student's typed values live only in this DOM: a real
   * navigation unmounts the source document and takes them with it, while a
   * client-side one opens the target as an overlay over a page that stays
   * mounted (#70).
   *
   * It is handed the href the chip is actually WEARING rather than resolving
   * the target a second time, so a click can never travel somewhere other than
   * where the chip says it goes.
   *
   * Optional, and its absence is a real fallback rather than a broken state —
   * the chip is a genuine `<a href>`, so the browser navigates on its own. The
   * student loses what they typed, which is worse, but nothing is dead.
   */
  followLink?(target: LinkTarget, href: string): void
  /**
   * Called after a student edit has been resolved through the whole document
   * (#68), with the formula elements whose LaTeX actually changed — usually a
   * subset, often empty. The caller re-typesets exactly those.
   *
   * Only CHANGED targets are reported, mirroring the editor's
   * `reRenderFormulasWithPlaceholders`: a formula that does not quote the
   * edited variable must not flicker through a re-typeset on every keystroke.
   */
  onRecompute?(changedTargets: HTMLElement[]): void
}

export interface DocumentRenderResult {
  /**
   * The `.render-target` element of every formula, in document order, each
   * carrying its resolved LaTeX in `data-latex` and its source in
   * `data-raw-latex`. The caller MathJax-renders them.
   */
  renderTargets: HTMLElement[]
  /**
   * Every link chip that became a navigable anchor, in document order, with
   * the link it carries (#74).
   *
   * Reported for the same reason `renderTargets` is: whether a target is still
   * REACHABLE — bought, archived, deleted — is a server question this module
   * refuses to ask, exactly as it refuses to typeset. The caller resolves them
   * and rewrites the ones that turn out to be unreachable.
   */
  links: RenderedDocumentLink[]
}

/** A link as it ended up in the rendered document: its data and its element. */
export type RenderedDocumentLink = DocumentLink & { anchor: HTMLAnchorElement }

const FIELD_SELECTOR = '.input-field, .output-field'

/**
 * Renders a published snapshot into `container`, replacing whatever was there.
 *
 * Throws if the snapshot cannot be rendered — the caller is expected to catch
 * that inside an error boundary and fall back to the stored PNG. Rendering
 * something partial is not an option: silently dropping a node means a paying
 * student misses a whole section with no indication.
 */
export function renderDocumentJson(
  doc: LatestEditorDocumentJson,
  container: HTMLElement,
  adapters: DocumentRenderAdapters
): DocumentRenderResult {
  const graph = domFieldGraph(container)

  let seq = 0
  const { renderTargets } = importEditorJson(doc, container, {
    nextFieldId: () => `sf_${++seq}`,
    resolvePlaceholders: (raw) => resolveFieldPlaceholders(graph, raw),
    imageUrl: adapters.imageUrl,
  })

  // Swap in the student controls BEFORE the first resolution, so the initial
  // render and every later recompute travel the exact same path. Safe at this
  // point because a field pill is opaque to resolution: `tokenizeLine` matches
  // it by class and never descends into it, and the graph reads only its
  // dataset — so span or input makes no difference to any resolved value.
  makeInputsEditable(container, graph, renderTargets, adapters)
  const links = makeLinksNavigable(container, adapters)

  resolveDocument(container, graph, renderTargets, { writeFormulaText: true })

  stripEditorChrome(container)

  return { renderTargets, links }
}

/**
 * Resolves the whole document against the current field values: every formula
 * in document order (so a later one sees an earlier one's `[output:x]`
 * write-back), then every pill from the settled graph. The same two-step the
 * controller performs after an import — and the ONLY path by which values
 * change, which is what makes a student's edit land on exactly the document a
 * fresh render of that value would have produced.
 *
 * Returns the formula elements whose resolved LaTeX actually changed.
 *
 * `writeFormulaText` puts the resolved source into the element as text. True on
 * the first render, where nothing is typeset yet and the source is what the
 * student would see if MathJax never arrives. False on a recompute, where the
 * element already holds typeset SVG and overwriting it would flash raw LaTeX
 * on every keystroke — the caller swaps in the new SVG instead.
 */
function resolveDocument(
  container: HTMLElement,
  graph: FieldGraph,
  renderTargets: HTMLElement[],
  { writeFormulaText }: { writeFormulaText: boolean }
): HTMLElement[] {
  const changed: HTMLElement[] = []
  for (const target of renderTargets) {
    const raw = target.dataset['rawLatex'] ?? ''
    if (!raw) continue
    const resolved = resolveFieldPlaceholders(graph, raw)
    if (target.dataset['latex'] !== resolved) changed.push(target)
    target.dataset['latex'] = resolved
    if (writeFormulaText) target.textContent = resolved
  }
  refreshFields(container, graph)
  return changed
}

/** Applies the resolved display state to every field pill in the container. */
function refreshFields(container: HTMLElement, graph: FieldGraph): void {
  for (const el of Array.from(container.querySelectorAll<HTMLElement>(FIELD_SELECTOR))) {
    const id = el.dataset['fieldId'] ?? ''
    if (!id) continue
    applyFieldDisplay(el, fieldDisplay(graph, id))
  }
}

/**
 * Shows a resolved value on a field, whichever shape that field has: a pill
 * shows it as text, a student control as its editable content.
 *
 * The one asymmetry is deliberate — the control the student is CURRENTLY IN
 * keeps its own text. Its resolved display is `value || '0'`, so refilling it
 * would put a „0" under the caret the moment the box is cleared to type a new
 * number. Every other clone of the same variable does follow along, and so
 * does this one as soon as the student leaves it.
 */
function applyFieldDisplay(el: HTMLElement, display: FieldDisplay): void {
  if (isStudentControl(el)) {
    const beingTyped = el.ownerDocument.activeElement === el
    showInControl(el, beingTyped ? el.value : formatGermanEntry(display.text))
    return // A static input is never a reference and never resolves to an error.
  }
  el.textContent = display.text
  el.classList.toggle('is-error', display.isError)
  el.classList.toggle('is-ref', display.isRef)
}

/**
 * Removes everything the importer builds for the sake of EDITING. Selected by
 * class and attribute rather than by block type, so an affordance added to the
 * importer later is stripped here without a matching change.
 */
function stripEditorChrome(container: HTMLElement): void {
  for (const el of Array.from(container.querySelectorAll('.drag-handle, .img-remove'))) {
    el.remove()
  }
  for (const el of Array.from(container.querySelectorAll('[draggable]'))) {
    el.removeAttribute('draggable')
  }
  // Captions are built `contenteditable="true"`; field pills carry
  // `contenteditable="false"`. Neither means anything inside a container that
  // is not editable, and leaving the "true" ones would let a student type into
  // the material they are studying.
  for (const el of Array.from(container.querySelectorAll('[contenteditable]'))) {
    el.removeAttribute('contenteditable')
  }
}

// ── Student-editable inputs (#68) ───────────────────────────────────────────

/**
 * Turns every visible STATIC input pill into a control the student can type
 * into. This is the whole of "interactive": the recompute graph was already
 * pure and live, what was missing was any way for a student to reach it —
 * values were set through an admin-only modal students never see.
 *
 * What stays read-only, and why it is a property of the data rather than of a
 * flag somebody has to remember to set:
 * - **outputs** are computed, so there is nothing to type;
 * - **reference inputs** (`refType: 'ref'`, including the drag-created output
 *   references) read another field's value, so typing into one would be a lie;
 * - **the hidden field masters** are `display:none` — a student cannot edit
 *   what they cannot see, and a variable with no visible clone is simply not
 *   offered.
 *
 * Everything else in the document — text, structure, formulas, images — is
 * already fixed by {@link stripEditorChrome}, so these controls end up the
 * only editable nodes in the whole surface.
 */
function makeInputsEditable(
  container: HTMLElement,
  graph: FieldGraph,
  renderTargets: HTMLElement[],
  adapters: DocumentRenderAdapters
): void {
  for (const pill of Array.from(container.querySelectorAll<HTMLElement>('.input-field'))) {
    if (pill.dataset['type'] !== 'input') continue
    if (pill.dataset['refType'] === 'ref') continue
    // `closest`, not a scoped `#hiddenFields` query: the id is unique per
    // rendered document, not per page, and a scoped id lookup resolves against
    // the whole document — it finds nothing the moment a second document is
    // mounted. Walking ancestors has no such trap.
    if (pill.closest('#hiddenFields')) continue
    // A field the graph cannot address is a field an edit could not resolve.
    const fieldId = pill.dataset['fieldId'] ?? ''
    if (!fieldId) continue

    const control = replaceWithControl(pill)
    // Per-element rather than delegated: the controls are rebuilt whenever the
    // container is re-rendered, so their listeners die with them and there is
    // no handle to dispose of.
    const applyEdit = (raw: string): void => {
      writeValueToClones(container, fieldId, raw)
      const changed = resolveDocument(container, graph, renderTargets, {
        writeFormulaText: false,
      })
      adapters.onRecompute?.(changed)
    }
    control.addEventListener('input', () => applyEdit(control.value))
    // Leaving the box settles it on the value the rest of the document is
    // actually computing with. Without this, a student who clears a box and
    // clicks away is left staring at an empty control while every dependent
    // value reads 0 — the two disagree, and nothing would reconcile them until
    // some other field happened to be edited.
    control.addEventListener('blur', () => {
      const settled = fieldDisplay(graph, fieldId).text
      showInControl(control, formatGermanEntry(settled))
      // Settling STORES the value, it does not merely show it. `fieldDisplay`
      // reads an empty static input as '0', but the stored '' stays
      // unparseable — so a cleared box would show „0" while every formula
      // quoting it rendered `\text{Err}`, the control and the document
      // disagreeing in the one place this handler exists to reconcile. A box
      // holding anything already settled is left alone, so the common blur
      // costs nothing.
      if (control.dataset['value'] !== settled) applyEdit(settled)
    })
  }
}

/** Swaps a pill for an input carrying the same identity and configuration. */
function replaceWithControl(pill: HTMLElement): HTMLInputElement {
  const control = pill.ownerDocument.createElement('input')
  // Copy the dataset wholesale rather than field by field: the graph reads the
  // pill's dataset, and a variable property added later must travel with it.
  for (const attr of Array.from(pill.attributes)) control.setAttribute(attr.name, attr.value)
  control.classList.add('student-input')
  // Free text, not `type="number"`: the resolver's contract is `parseFloat` on
  // whatever string is stored, spinners are wrong for a value inside a
  // sentence, and a half-typed number must not be rejected by the browser.
  control.type = 'text'
  // ⚠ iOS shows no minus key on the decimal pad, so a negative value has to be
  // pasted there. Taken deliberately: every input in these documents gets a
  // numeric keypad, and a quantity in a worked example is very rarely negative.
  control.inputMode = 'decimal'
  control.autocomplete = 'off'
  control.spellcheck = false
  const name = pill.dataset['name']?.trim()
  control.setAttribute('aria-label', name ? `Eingabewert ${name}` : 'Eingabewert')
  showInControl(control, formatGermanEntry(pill.dataset['value'] || '0'))
  pill.replaceWith(control)
  return control
}

/**
 * Puts text in a control and re-marks it: width to fit, and whether what it
 * now holds reads as a number at all.
 *
 * The error mark is the same `is-error` the resolver's pills use, because it
 * means the same thing — this does not resolve. It is the only signal a
 * student gets that their own typing is the problem: an unparseable value
 * substitutes as `(0)` inside an expression by the resolver's documented
 * rules, so without it the document would just quietly compute with zero. An
 * EMPTY box is not marked — that is a box mid-edit, not a mistake.
 */
function showInControl(control: HTMLInputElement, text: string): void {
  control.value = text
  control.size = controlSize(text)
  const trimmed = text.trim()
  // A lone sign or separator is a number halfway typed, not a wrong one.
  const midEntry = /^[+-]?[.,]?$/.test(trimmed)
  // `parseFloat`, deliberately: the mark must agree with what the document is
  // actually computing with, and `parseFloat` is the resolver's contract for
  // reading a stored value — including its leniency about trailing rubbish.
  const unparseable =
    trimmed !== '' && !midEntry && !Number.isFinite(parseFloat(parseGermanEntry(text)))
  control.classList.toggle('is-error', unparseable)
  if (unparseable) control.setAttribute('aria-invalid', 'true')
  else control.removeAttribute('aria-invalid')
}

/**
 * Writes a student's value onto every clone of the variable — the read-only
 * mirror of the editor's `syncFieldClones`. Required, not cosmetic: the graph
 * resolves a field through the FIRST element carrying its id, which is rarely
 * the one being typed into.
 *
 * The typed text is normalised the German way first, because every number the
 * document itself displays is German-formatted: a student reading „1 050" and
 * „7,5" would otherwise have „7,5" silently truncated to 7 by `parseFloat`.
 * Only student input is normalised — an authored value stored in the snapshot
 * is left exactly as the author wrote it.
 */
function writeValueToClones(container: HTMLElement, fieldId: string, raw: string): void {
  if (!fieldId) return
  const value = parseGermanEntry(raw)
  // Plain interpolation is safe here for the same reason it is in
  // `domFieldGraph`: every id passed through the importer's `safeFieldId`.
  for (const el of Array.from(
    container.querySelectorAll<HTMLElement>(`[data-field-id="${fieldId}"]`)
  )) {
    el.dataset['value'] = value
  }
}

/**
 * Width in characters, so a control sits in a sentence at the size of its
 * value instead of at the browser's 20-character default. `size` must be at
 * least 1 — browsers throw on 0 — and a floor of 3 keeps an emptied box a
 * usable tap target.
 */
function controlSize(value: string): number {
  return Math.max(3, value.length)
}

/** A field rendered as the student's editable control rather than as a pill. */
function isStudentControl(el: HTMLElement): el is HTMLInputElement {
  return el.tagName === 'INPUT' && el.classList.contains('student-input')
}

// ── Link chips (#73) ────────────────────────────────────────────────────────

/**
 * Turns every link the author placed into one a student can follow. The
 * importer builds the same opaque `contenteditable="false"` span the editor
 * uses — right for a surface where a link is a thing to re-target, wrong for
 * one where it is a thing to travel through.
 *
 * So a chip becomes a real `<a href>`, the same swap {@link replaceWithControl}
 * makes for inputs and for the same reason: the platform then supplies what
 * would otherwise be a hand-rolled key handler — focus order, activation by
 * Enter, „open in new tab", and the browser's own navigation when nothing
 * intercepts the click.
 *
 * WHAT IS DELIBERATELY ABSENT IS HOVER. Nothing previews, nothing prefetches on
 * mouse-over, no `title` tooltip: the peek was dropped (spec §6) because the
 * overlay does it better one click away, and a hover would make the product
 * quietly different on a touch screen. The label plus the kind glyph is the
 * whole of "say where you go before I click".
 */
function makeLinksNavigable(
  container: HTMLElement,
  adapters: DocumentRenderAdapters
): RenderedDocumentLink[] {
  const rendered: RenderedDocumentLink[] = []
  for (const chip of Array.from(container.querySelectorAll<HTMLElement>(LINK_CHIP_SELECTOR))) {
    const link = readLinkChip(chip)
    // Not reachable through the importer, which only builds a chip from a
    // parsed link node. Left exactly as it is rather than guessed at: the
    // words stay in the sentence, unlinked.
    if (!link) continue

    const href = adapters.linkHref(link.target)
    const anchor = replaceWithLinkAnchor(chip, link, href)
    // Per-element, like the input controls: they are rebuilt whenever the
    // container is re-rendered, so their listeners die with them.
    anchor.addEventListener('click', (event) => {
      const follow = adapters.followLink
      if (!follow || !isPlainLeftClick(event)) return
      // Without this the browser navigates as well, unmounting the document
      // and everything the student typed into it.
      event.preventDefault()
      follow(link.target, href)
    })
    rendered.push({ ...link, anchor })
  }
  return rendered
}

/** Swaps an authoring chip for the student's navigable one. */
function replaceWithLinkAnchor(
  chip: HTMLElement,
  link: DocumentLink,
  href: string
): HTMLAnchorElement {
  const anchor = chip.ownerDocument.createElement('a')
  // Copy every attribute wholesale, as the input control does: `data-link-*` is
  // the chip's identity, `class` is what the stylesheet matches, and a key
  // added to the link node later travels with them. The editor-only
  // `contenteditable` rides along and is taken off by `stripEditorChrome`,
  // which is where every such attribute goes.
  for (const attr of Array.from(chip.attributes)) anchor.setAttribute(attr.name, attr.value)
  anchor.setAttribute('href', href)
  // The glyph is drawn by CSS from this attribute rather than written into the
  // chip, so it never lands in the text a student selects and copies out — the
  // same rule the authoring chip follows, reading the same map.
  anchor.dataset['linkIcon'] = linkTargetIcon(link.target)
  // Which means a screen reader would get nothing at all from it. This is how
  // "what kind of thing does this point at" reaches a reader who cannot see the
  // icon (spec §6, user story 19).
  anchor.setAttribute('aria-label', `${link.label} – ${linkTargetKindLabel(link.target)}`)
  anchor.textContent = link.label
  chip.replaceWith(anchor)
  return anchor
}

// ── Field graph over the rendered DOM ───────────────────────────────────────

function fieldDataFrom(el: HTMLElement): FieldData {
  const data: FieldData = {
    id: el.dataset['fieldId'] ?? '',
    type: el.dataset['type'] === 'output' ? 'output' : 'input',
    name: el.dataset['name'] ?? '',
  }
  if (el.dataset['refType'] !== undefined) {
    data.refType = el.dataset['refType'] === 'ref' ? 'ref' : 'static'
  }
  if (el.dataset['value'] !== undefined) data.value = el.dataset['value']
  if (el.dataset['refId'] !== undefined) data.refId = el.dataset['refId']
  if (el.dataset['expr'] !== undefined) data.expr = el.dataset['expr']
  if (el.dataset['latexValue'] !== undefined) data.latexValue = el.dataset['latexValue']
  return data
}

/** Top-level block of the container that contains `el`, or null. */
function topLevelBlock(container: HTMLElement, el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el
  while (node && node.parentElement && node.parentElement !== container) {
    node = node.parentElement
  }
  return node && node.parentElement === container ? node : null
}

/** Characters and field pills of a line, in document order (reference tokenizeLine). */
function tokenizeLine(line: Node): LineToken[] {
  const tokens: LineToken[] = []
  function walk(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      for (const ch of node.textContent ?? '') tokens.push({ char: ch })
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as HTMLElement
    if (el.classList.contains('drag-handle')) return
    if (el.classList.contains('input-field') || el.classList.contains('output-field')) {
      tokens.push({ fieldId: el.dataset['fieldId'] ?? '' })
      return
    }
    for (const child of Array.from(node.childNodes)) walk(child)
  }
  walk(line)
  return tokens
}

/**
 * The same thin DOM adapter the controller implements, over the rendered
 * document. Sharing the shape is the point: the resolver sees plain objects
 * and cannot tell the editor and the student view apart, so both resolve
 * identically — including the `[output:x]` write-back, which must be visible
 * to later reads within the same pass.
 *
 * Exported because the student-editable inputs of #68 recompute against it.
 */
export function domFieldGraph(container: HTMLElement): FieldGraph {
  // Plain interpolation, as the controller does: the importer runs every id
  // through `safeFieldId`, which leaves only [A-Za-z0-9_\-:.] — no quote can
  // reach this selector. (CSS.escape is also absent in jsdom.)
  const elementById = (id: string): HTMLElement | null =>
    container.querySelector<HTMLElement>(`[data-field-id="${id}"]`)

  return {
    byId(id) {
      const el = elementById(id)
      return el ? fieldDataFrom(el) : null
    },
    all() {
      return Array.from(container.querySelectorAll<HTMLElement>(FIELD_SELECTOR)).map(fieldDataFrom)
    },
    lineTokensFor(fieldId) {
      const el = elementById(fieldId)
      if (!el) return null
      const line = topLevelBlock(container, el)
      if (!line) return null
      // Hidden masters have no text-line context (reference L1532).
      if (line.id === 'hiddenFields') return null
      return tokenizeLine(line)
    },
    setLatexValue(fieldId, v) {
      const el = elementById(fieldId)
      if (!el) return
      if (Number.isFinite(v)) {
        el.dataset['latexValue'] = String(v)
        el.textContent = formatValue(v)
        el.classList.remove('is-error')
      } else {
        delete el.dataset['latexValue']
        el.textContent = 'Err'
        el.classList.add('is-error')
      }
    },
  }
}
