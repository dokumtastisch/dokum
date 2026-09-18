/**
 * document-json — versioned JSON persistence for the LaTeX editor
 * (PRD #28, slice 7 — #35).
 *
 * Three parts:
 *
 * 1. `DocumentJsonSchema` — the versioned Zod schema: a DISCRIMINATED UNION
 *    over `version` (#64), members v1.0 and v1.1. v1.1 adds the optional
 *    block-level `anchor` — a Sprungmarke another document can link to (#71) —
 *    and the inline `link` node that points at one (#72, shape owned by
 *    links.ts); v1.0 snapshots reach it through the upgrade chain, and a v1.0
 *    snapshot carrying either is refused rather than read as a shape its
 *    version does not describe. It doubles as
 *    the server-action validation for draft saves (operator story
 *    34: malformed content is rejected at the boundary). Reading a stored
 *    snapshot goes through `readDocumentJson` (document-version.ts), which
 *    parses here and then migrates to the newest version. The schema is a
 *    SUPERSET of the standalone editor's import format (reference file
 *    latexEditor/latex_editor_FIXED_JSON_IMPORT_COMPLETE_OUTPUT_AS_INPUT_LATEX_FIX.htm.html,
 *    `JSON_IMPORT_EXAMPLE` L2310): the reference example validates verbatim.
 *    Slice-7 extensions, required for exact draft round-trips:
 *      - top-level `library: string[]` — the full formula-library list (the
 *        reference's per-formula `library` flag cannot represent library
 *        items whose formula block was edited or deleted);
 *      - variable extras `latexValue`, `referenceClone`, `sourceOutputName`
 *        (stored `[output:x]` results and drag-created output-reference
 *        pills);
 *      - block type `code` (the reference importer had no `pre` mapping, but
 *        the editor creates `<pre>` blocks via „Als Codeblock" / formatBlock);
 *      - block type `image` (slice 8, #36) as a STORAGE REFERENCE: the
 *        reference importer accepted `{ type:'image', src }`, but accepting
 *        arbitrary `src` would let base64 payloads into drafts (PRD forbids
 *        that). v1.0 image blocks carry only `imageId` — the `editor_images`
 *        row id served by the signed-URL proxy route — so base64 is
 *        structurally impossible; reference exports with embedded `src`
 *        images are rejected at the boundary by design. The schema stays
 *        strict (unknown keys and block types are rejected).
 *
 * 2. `importEditorJson` — ported from the reference importer (L2388–2608).
 *    Consolidation deviations (approved in #35 planning):
 *      - no per-span click listeners on imported pills (reference L2438,
 *        L2501) — the port delegates pill clicks via the controller's
 *        `onEditorClick`, the approved slice-5 deviation, which also covers
 *        imported clones;
 *      - MathJax rendering, library restore and the field refresh (the
 *        reference's `setTimeout` in `createBlock` L2550 and the post-import
 *        hook L2731) are returned as {@link ImportResult} for the controller
 *        to perform — this module stays MathJax-free and jsdom-testable;
 *      - DOM is built via `createElement`/`dataset` on `editor.ownerDocument`
 *        instead of escaped `innerHTML` strings (equivalent output).
 *
 * 3. Boundary helpers for the JSON import modal (slice 9, #37):
 *    `JSON_IMPORT_EXAMPLE` — the reference file's example document
 *    (L2310–2328), verbatim — and `describeDocumentJsonError` — German
 *    messages for failed schema parses. The modal validates pasted JSON
 *    against the STRICT schema (operator story 34); the importer itself
 *    stays reference-lenient for anything the schema admits.
 *
 * 4. `serializeEditorState` — NEWLY WRITTEN (no reference counterpart; the
 *    standalone editor could import JSON but never export it). Contract:
 *    export → import → export is byte-stable — for any serializer-produced
 *    J1, `JSON.stringify(J1) === JSON.stringify(serialize(import(J1)))`.
 *    This drives the canonicalisation rules (fixed key order, rgb→hex
 *    colours, `fontWeight:700` → `bold`, px font sizes → numbers, adjacent
 *    text merging, lone-`<br>` lines → empty children) and the deterministic
 *    variable ordering: fields with an inline occurrence first (content
 *    order), then hidden-store-only fields (store order) — the order the
 *    importer itself reproduces.
 *
 * Pure module: no controller state, no MathJax, no server imports. DOM nodes
 * are created through the passed editor's `ownerDocument`, so it runs in the
 * browser and in jsdom tests alike.
 */

import { z } from 'zod'
import { AnchorSchema, readBlockAnchor, writeBlockAnchor, type DocumentAnchor } from './anchors'
import {
  LINK_CHIP_CLASS,
  LinkNodeSchema,
  createLinkChip,
  readLinkChip,
  type LinkNode,
} from './links'

// ── Schema (versions 1.0 and 1.1) ───────────────────────────────────────────

const StyleSchema = z.strictObject({
  color: z.string().optional(),
  backgroundColor: z.string().optional(),
  /** Reference alias for backgroundColor (applyStyle, L2425). */
  highlight: z.string().optional(),
  fontSize: z.union([z.number(), z.string()]).optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strike: z.boolean().optional(),
  /** Reference alias for strike (applyStyle, L2431). */
  strikethrough: z.boolean().optional(),
  align: z.string().optional(),
})

export type EditorTextStyle = z.infer<typeof StyleSchema>

/**
 * One inline node: the shapes the reference `createInlineNodes` (L2449)
 * accepts — plain strings/numbers, `{br}`, styled text, field references by
 * name or id, nested styled groups — plus the v1.1 `link` node (#72).
 *
 * This TS type is the union across ALL supported versions, deliberately: the
 * runtime schemas are versioned apart (see {@link inlineNodeSchema}), while
 * every consumer of a parsed document works on the NEWEST version, which
 * `upgradeDocumentJson` guarantees. Splitting the type per version would buy
 * precision nothing reads.
 */
export type InlineNode =
  | string
  | number
  | { br: true }
  | { type: 'br' }
  | { text: string | number; style?: EditorTextStyle }
  | { field?: string; fieldId?: string }
  | LinkNode
  | { children: InlineNode[]; style?: EditorTextStyle }

/**
 * The inline union of ONE schema version. `extra` holds the node types that
 * version added — today just the v1.1 `link`.
 *
 * The parameter is what keeps the version discriminator meaningful all the way
 * down: v1.0 and v1.1 differ in their inline vocabulary, not only in their
 * block shape, so a v1.0 snapshot carrying a link is refused rather than read
 * as something its version does not describe (spec #63 §2). The `children`
 * group recurses into the SAME version, so a link cannot smuggle itself into a
 * v1.0 document by hiding inside a styled group either.
 */
function inlineNodeSchema(extra: readonly z.ZodType<InlineNode>[]): z.ZodType<InlineNode> {
  const self: z.ZodType<InlineNode> = z.lazy(() =>
    z.union([
      z.string(),
      z.number(),
      z.strictObject({ br: z.literal(true) }),
      z.strictObject({ type: z.literal('br') }),
      z.strictObject({
        text: z.union([z.string(), z.number()]),
        style: StyleSchema.optional(),
      }),
      z
        .strictObject({
          field: z.string().optional(),
          fieldId: z.string().optional(),
        })
        .refine((v) => v.field !== undefined || v.fieldId !== undefined, {
          message: 'Feldreferenz benötigt "field" oder "fieldId".',
        }),
      ...extra,
      z.strictObject({
        children: z.array(self),
        style: StyleSchema.optional(),
      }),
    ])
  )
  return self
}

const InlineNodeSchemaV1_0 = inlineNodeSchema([])
const InlineNodeSchemaV1_1 = inlineNodeSchema([LinkNodeSchema])

/**
 * The four block types whose content is inline, built against one version's
 * inline union. `code` and `image` hold no inline nodes, so they are shared
 * across versions unchanged.
 *
 * Key order inside each shape is part of the byte-stability contract — the
 * serializer emits these keys in this order, and a parse reproduces the shape
 * order, so the two must not drift.
 */
function inlineBlockSchemas(inline: z.ZodType<InlineNode>) {
  /** Reference list items: an inline array or `{ children }` / `{ text }` (L2531). */
  const ListItemSchema = z.union([
    z.array(inline),
    z.strictObject({
      children: z.array(inline).optional(),
      text: z.union([z.string(), z.number()]).optional(),
    }),
  ])

  /** Reference captions: a plain string or `{ children }` / `{ text }` (L2547). */
  const CaptionSchema = z.union([
    z.string(),
    z.strictObject({
      children: z.array(inline).optional(),
      text: z.union([z.string(), z.number()]).optional(),
    }),
  ])

  return {
    paragraph: z.strictObject({
      type: z.literal('paragraph'),
      children: z.array(inline).optional(),
      text: z.union([z.string(), z.number()]).optional(),
      style: StyleSchema.optional(),
    }),
    heading: z.strictObject({
      type: z.literal('heading'),
      level: z.number().optional(),
      children: z.array(inline).optional(),
      text: z.union([z.string(), z.number()]).optional(),
      style: StyleSchema.optional(),
    }),
    list: z.strictObject({
      type: z.literal('list'),
      ordered: z.boolean().optional(),
      items: z.array(ListItemSchema).optional(),
      style: StyleSchema.optional(),
    }),
    formula: z.strictObject({
      type: z.literal('formula'),
      latex: z.string().optional(),
      /** Reference alias (L2538). */
      rawLatex: z.string().optional(),
      /** Reference per-formula library flag — only consulted when the top-level `library` list is absent. */
      library: z.boolean().optional(),
      caption: CaptionSchema.optional(),
      style: StyleSchema.optional(),
    }),
  }
}

const InlineBlocksV1_0 = inlineBlockSchemas(InlineNodeSchemaV1_0)
const InlineBlocksV1_1 = inlineBlockSchemas(InlineNodeSchemaV1_1)

/** Slice-7 extension — the reference importer had no mapping for `<pre>` blocks. */
const CodeBlockSchema = z.strictObject({
  type: z.literal('code'),
  text: z.union([z.string(), z.number()]).optional(),
  style: StyleSchema.optional(),
})

/**
 * Slice-8 storage-reference image block (#36). Deliberately NO `src` field —
 * `strictObject` rejects it, which is what makes base64 image payloads
 * structurally impossible in drafts (PRD hard constraint). `imageId` is the
 * `editor_images` row id; the browser URL is derived via the import adapter.
 */
const ImageBlockSchema = z.strictObject({
  type: z.literal('image'),
  imageId: z.string().uuid('Ungültige Bildreferenz.'),
  alt: z.string().optional(),
  style: StyleSchema.optional(),
})

/** The v1.0 block union — the six block types, none of them anchorable. */
const BlockSchemaV1_0 = z.discriminatedUnion('type', [
  InlineBlocksV1_0.paragraph,
  InlineBlocksV1_0.heading,
  InlineBlocksV1_0.list,
  InlineBlocksV1_0.formula,
  CodeBlockSchema,
  ImageBlockSchema,
])

/**
 * The one thing v1.1 adds: a Sprungmarke (#71) — the opaque id another
 * document's link stores, plus the author-written label. Defined in
 * anchors.ts, which also owns its DOM contract.
 *
 * Appended LAST in every block's shape, matching the position the serializer
 * emits it in — parse order and emit order have to agree for the
 * byte-stability contract to survive a publish, which stores the PARSED
 * snapshot.
 */
const AnchorExtension = { anchor: AnchorSchema.optional() }

/**
 * The v1.1 block union — v1.0 plus the optional block-level anchor, over the
 * v1.1 inline vocabulary (which is where the `link` node lives).
 */
const BlockSchemaV1_1 = z.discriminatedUnion('type', [
  InlineBlocksV1_1.paragraph.extend(AnchorExtension),
  InlineBlocksV1_1.heading.extend(AnchorExtension),
  InlineBlocksV1_1.list.extend(AnchorExtension),
  InlineBlocksV1_1.formula.extend(AnchorExtension),
  CodeBlockSchema.extend(AnchorExtension),
  ImageBlockSchema.extend(AnchorExtension),
])

const VariableSchema = z.strictObject({
  id: z.union([z.string(), z.number()]).optional(),
  type: z.enum(['input', 'output']),
  name: z.union([z.string(), z.number()]).optional(),
  refType: z.enum(['static', 'ref']).optional(),
  value: z.union([z.string(), z.number()]).optional(),
  refId: z.union([z.string(), z.number()]).optional(),
  refName: z.string().optional(),
  /** Reference alias for refName (createFieldMaster, L2492). */
  ref: z.string().optional(),
  expr: z.string().optional(),
  /** Slice-7 extension: value persisted by a LaTeX `[output:x]` resolution. */
  latexValue: z.string().optional(),
  /** Slice-7 extension: drag-created output-reference pill (hidden in the variables sidebar). */
  referenceClone: z.boolean().optional(),
  /** Slice-7 extension: display name of the referenced Output on a reference clone. */
  sourceOutputName: z.string().optional(),
})

// ── Versioned family (#64) ──────────────────────────────────────────────────

/**
 * Every document-JSON version this build can read, OLDEST FIRST; the last
 * entry is the version the serializer emits. `version` is a discriminated
 * union rather than a literal so a new node type can ship without either
 * rejecting every stored snapshot or rewriting them all in place — the
 * prefactor the linking and video work sit on.
 *
 * Adding a version means all four of: append it here, add its
 * `DocumentJsonV<n>Schema` to the union below, point
 * `LATEST_DOCUMENT_JSON_VERSION` at it, and add the vN→vN+1 step in
 * document-version.ts. The upgrade chain is a total record over this list, so
 * a half-done addition fails to compile.
 */
export const DOCUMENT_JSON_VERSIONS = ['1.0', '1.1'] as const

export type DocumentJsonVersion = (typeof DOCUMENT_JSON_VERSIONS)[number]

/** The version `serializeEditorState` emits and the renderer understands. */
export const LATEST_DOCUMENT_JSON_VERSION = '1.1' satisfies DocumentJsonVersion

/** German enumeration of the supported versions — `"1.0"`, `"1.0" oder "1.1"`, … */
function supportedVersionList(): string {
  const quoted = DOCUMENT_JSON_VERSIONS.map((v) => `"${v}"`)
  if (quoted.length === 1) return quoted[0]
  return quoted.slice(0, -1).join(', ') + ' oder ' + quoted[quoted.length - 1]
}

/**
 * Save-time metadata. `term` is the ExportBar's free Term field (slice 10,
 * #38): the React shell injects it via `withDocumentMeta` right before the
 * save — `serializeEditorState` itself stays meta-free (its export→import→
 * export byte-stability contract must keep holding), and the importer
 * deliberately ignores meta, so a JSON-modal import never changes the Term
 * field (accepted limitation; the Term reloads only with the draft).
 * `title` is reference-compat only — the draft title lives in the DB
 * column (single source of truth, decision D11).
 */
const MetaSchema = z.strictObject({
  title: z.string().optional(),
  term: z.string().optional(),
})

const VariablesSchema = z.array(VariableSchema).superRefine((vars, ctx) => {
  // Mirrors the importer's validateUniqueImportedVariables (reference L2410)
  // so duplicates are already rejected at the server boundary.
  const seen = new Set<string>()
  for (const v of vars) {
    const name = strictText(v.name).trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) {
      ctx.addIssue({
        code: 'custom',
        message:
          'Doppelter Variablenname im JSON: "' + name + '". Variablennamen müssen eindeutig sein.',
      })
      return
    }
    seen.add(key)
  }
})

/** Slice-7 extension: the full ordered formula-library LaTeX list (authoritative when present). */
const LibrarySchema = z.array(z.string())

const DocumentJsonV1_0Schema = z.strictObject({
  version: z.literal('1.0'),
  meta: MetaSchema.optional(),
  variables: VariablesSchema,
  content: z.array(BlockSchemaV1_0),
  library: LibrarySchema.optional(),
})

/**
 * v1.1 (#71) — identical to v1.0 except that blocks may carry a Sprungmarke.
 * The version is what keeps that honest in both directions: a v1.1 snapshot
 * may have anchors, and a v1.0 snapshot claiming one is refused rather than
 * quietly read as something its version does not describe.
 *
 * The key order mirrors v1.0 exactly — publishing stores this parsed object,
 * so the shape order here is the stored order.
 */
const DocumentJsonV1_1Schema = z.strictObject({
  version: z.literal('1.1'),
  meta: MetaSchema.optional(),
  variables: VariablesSchema,
  content: z.array(BlockSchemaV1_1),
  library: LibrarySchema.optional(),
})

/**
 * The versioned family. A snapshot whose `version` is not in
 * {@link DOCUMENT_JSON_VERSIONS} fails on the `version` path — which is what
 * lets {@link describeDocumentJsonError} refuse it with a clear German
 * message instead of letting it fail as an unreadable shape mismatch.
 */
export const DocumentJsonSchema = z.discriminatedUnion('version', [
  DocumentJsonV1_0Schema,
  DocumentJsonV1_1Schema,
])

/** A snapshot at ANY version this build can read — what the schema parses. */
export type EditorDocumentJson = z.infer<typeof DocumentJsonSchema>
/**
 * A snapshot at the NEWEST version — what `serializeEditorState` emits and
 * what the importer and the student renderer consume. Older snapshots reach
 * this type through `upgradeDocumentJson` (document-version.ts), never by
 * being passed straight through.
 */
export type LatestEditorDocumentJson = z.infer<typeof DocumentJsonV1_1Schema>
export type EditorDocumentVariable = z.infer<typeof VariableSchema>
/** A block at the NEWEST version — what the serializer emits, anchor included. */
export type EditorDocumentBlock = z.infer<typeof BlockSchemaV1_1>

// ── JSON import modal boundary helpers (slice 9, #37) ───────────────────────

/**
 * The reference file's `JSON_IMPORT_EXAMPLE` (L2310–2328), verbatim — the
 * modal's „Beispiel laden" fills the textarea with this document. The test
 * suite guards it against drift from the reference golden copy.
 *
 * Still a v1.0 document, deliberately: it is a verbatim reference copy, and
 * leaving it there keeps „Beispiel laden" exercising the upgrade-on-read hop
 * the modal performs for every pasted snapshot.
 */
export const JSON_IMPORT_EXAMPLE = {
  version: '1.0',
  meta: { title: 'Example JSON import' },
  variables: [
    { id: 'v_revenue', type: 'input', name: 'Revenue', value: 1200 },
    { id: 'v_margin', type: 'input', name: 'Margin', value: 0.2534 },
    { id: 'v_ebit', type: 'output', name: 'EBIT', expr: '' },
  ],
  content: [
    {
      type: 'heading',
      level: 1,
      children: [{ text: 'Imported valuation note', style: { color: '#00338D', bold: true } }],
    },
    {
      type: 'paragraph',
      children: [
        { text: 'Revenue: ' },
        { field: 'Revenue' },
        { text: ' | Margin: ' },
        { field: 'Margin' },
      ],
    },
    {
      type: 'formula',
      latex: '\\begin{aligned}EBIT &= [input:Revenue] * [input:Margin] = [output:EBIT]\\end{aligned}',
      library: true,
    },
    {
      type: 'paragraph',
      children: [{ text: 'Result: ', style: { bold: true } }, { field: 'EBIT' }],
    },
  ],
} satisfies EditorDocumentJson

/** `content[2].children[0]`-style dot/bracket path of a Zod issue. */
function formatIssuePath(path: ReadonlyArray<PropertyKey>): string {
  let out = ''
  for (const seg of path) {
    out += typeof seg === 'number' ? `[${seg}]` : out ? `.${String(seg)}` : String(seg)
  }
  return out
}

/** The issue with the longest path — the most specific location Zod reports. */
function mostSpecificIssue(issues: z.ZodIssue[]): z.ZodIssue | undefined {
  let best: z.ZodIssue | undefined
  for (const issue of issues) {
    if (!best || issue.path.length > best.path.length) best = issue
  }
  return best
}

/**
 * German error message for a failed `DocumentJsonSchema` parse — shown by the
 * JSON import modal, and the refusal text of the read boundary
 * (`readDocumentJson`, document-version.ts). Pragmatic per the slice-9
 * decisions: German lead-in plus
 * special-cased common failures (root shape, schema version, reference-style
 * image blocks with embedded `src` — the whole import fails for those by
 * design, base64 must stay structurally impossible). Other Zod detail
 * messages may remain technical/English after the lead-in — matching the
 * server boundary, which returns raw first-issue messages (parseForm).
 *
 * `raw` is the already-JSON.parsed input, used to detect the image-`src`
 * case; it is never mutated.
 */
export function describeDocumentJsonError(error: z.ZodError, raw: unknown): string {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return 'Das JSON muss ein Objekt mit { version, variables, content } sein.'
  }

  // The version label enumerates DOCUMENT_JSON_VERSIONS rather than naming
  // 1.0, so the boundary keeps telling the truth as versions are added.
  const formatLabel = `Version ${DOCUMENT_JSON_VERSIONS.join('/')}`

  const issue = mostSpecificIssue(error.issues)
  if (!issue) return `Das JSON entspricht nicht dem Dokumentformat (${formatLabel}).`

  const path = issue.path
  if (path[0] === 'version') {
    return `Nicht unterstützte Schema-Version — erwartet wird ${supportedVersionList()}.`
  }
  if (path[0] === 'content' && typeof path[1] === 'number') {
    const content = (raw as Record<string, unknown>)['content']
    const block: unknown = Array.isArray(content) ? content[path[1]] : undefined
    if (
      block !== null &&
      typeof block === 'object' &&
      (block as Record<string, unknown>)['type'] === 'image' &&
      'src' in (block as object)
    ) {
      return (
        'Bild-Blöcke referenzieren gespeicherte Bilder über "imageId" — ' +
        'eingebettete "src"-Bilder werden nicht unterstützt. ' +
        'Bitte Bilder über „Bild einfügen" hochladen.'
      )
    }
  }
  // Own refine/superRefine messages are complete German sentences already
  // (duplicate variable names, field-reference shape).
  if (issue.code === 'custom' && issue.message) return issue.message

  const detail =
    issue.code === 'unrecognized_keys'
      ? 'Unbekannte Eigenschaft(en): ' + issue.keys.map((k) => `"${k}"`).join(', ')
      : issue.code === 'invalid_union'
        ? 'Kein gültiger Block-/Inline-Knoten an dieser Stelle.'
        : issue.message
  const where = path.length ? formatIssuePath(path) : 'Dokument'
  return `Das JSON entspricht nicht dem Dokumentformat (${formatLabel}) — ${where}: ${detail}`
}

// ── Shared helpers (reference L2388–2390) ───────────────────────────────────

function strictText(v: unknown): string {
  return v === null || v === undefined ? '' : String(v)
}

function normaliseName(name: unknown): string {
  return strictText(name).trim().toLowerCase()
}

function safeFieldId(raw: string, nextFieldId: () => string): string {
  return strictText(raw || nextFieldId()).replace(/[^a-zA-Z0-9_\-:.]/g, '_')
}

// ── Importer (ported, reference L2392–2608) ─────────────────────────────────

export interface ImportAdapters {
  /** The controller's field-id generator (deterministic stub in tests). */
  nextFieldId(): string
  /**
   * `resolveForDisplay` of the controller — `[input:x]`/`[output:x]`
   * resolution incl. the output-as-input write-back (identity in tests; the
   * serializer never reads the resolved value).
   */
  resolvePlaceholders(raw: string): string
  /**
   * Browser URL for a stored editor image (slice 8): the controller passes
   * `editorImageUrl` (the signed-URL proxy route); tests pass a stub. The
   * serializer never reads the URL back — only `data-image-id`.
   */
  imageUrl(imageId: string): string
}

export interface ImportResult {
  /**
   * The `.render-target` elements of all imported formula blocks, in document
   * order — the controller MathJax-renders them (the reference did this via
   * `setTimeout` per block, L2550, plus the post-import re-render L2731).
   */
  renderTargets: HTMLElement[]
  /**
   * Ordered LaTeX list to restore into the library sidebar: the document's
   * top-level `library` when present (authoritative, slice-7 extension),
   * otherwise derived from formula blocks with `library !== false`
   * (reference behavior, L2553). The controller's `addToLibrary` dedups.
   */
  libraryLatex: string[]
}

interface InlineContext {
  docEl: Document
  fieldByName: Map<string, HTMLElement>
  fieldById: Map<string, HTMLElement>
}

function getOrCreateHiddenStore(editor: HTMLElement): HTMLElement {
  let store = editor.querySelector<HTMLElement>('#hiddenFields')
  if (!store) {
    store = editor.ownerDocument.createElement('div')
    store.id = 'hiddenFields'
    store.style.display = 'none'
    store.setAttribute('contenteditable', 'false')
    editor.appendChild(store)
  }
  return store
}

function fieldNameExistsInEditor(editor: HTMLElement, name: string): boolean {
  const target = normaliseName(name)
  if (!target) return false
  return Array.from(
    editor.querySelectorAll<HTMLElement>('.input-field, .output-field')
  ).some((f) => normaliseName(f.dataset['name']) === target)
}

function validateUniqueImportedVariables(
  editor: HTMLElement,
  vars: EditorDocumentVariable[],
  replaceExisting: boolean
): void {
  const seen = new Set<string>()
  for (const v of vars) {
    const name = strictText(v.name).trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) {
      throw new Error(
        'Doppelter Variablenname im JSON: "' + name + '". Variablennamen müssen eindeutig sein.'
      )
    }
    seen.add(key)
    if (!replaceExisting && fieldNameExistsInEditor(editor, name)) {
      throw new Error(
        'Variablenname existiert bereits im Editor: "' +
          name +
          '". Bitte eindeutigen Namen verwenden oder Import mit Ersetzen ausführen.'
      )
    }
  }
}

function applyStyle(el: HTMLElement, style: EditorTextStyle | undefined): void {
  if (!style || typeof style !== 'object') return
  if (style.color) el.style.color = style.color
  if (style.backgroundColor || style.highlight) {
    el.style.backgroundColor = style.backgroundColor || style.highlight || ''
  }
  if (style.fontSize) {
    el.style.fontSize =
      typeof style.fontSize === 'number' ? style.fontSize + 'px' : style.fontSize
  }
  if (style.bold) el.style.fontWeight = '700'
  if (style.italic) el.style.fontStyle = 'italic'
  const decorations: string[] = []
  if (style.underline) decorations.push('underline')
  if (style.strike || style.strikethrough) decorations.push('line-through')
  if (decorations.length) el.style.textDecoration = decorations.join(' ')
  if (style.align) el.style.textAlign = style.align
}

function createTextSpan(
  docEl: Document,
  node: { text: string | number; style?: EditorTextStyle }
): HTMLElement {
  const span = docEl.createElement('span')
  span.textContent = strictText(node.text)
  applyStyle(span, node.style)
  return span
}

function createFieldMaster(
  v: EditorDocumentVariable,
  editor: HTMLElement,
  idMap: Map<string, string>,
  nextFieldId: () => string
): HTMLElement {
  const docEl = editor.ownerDocument
  const span = docEl.createElement('span')
  const type = v.type === 'output' ? 'output' : 'input'
  span.className = type === 'input' ? 'input-field' : 'output-field'
  span.setAttribute('contenteditable', 'false')
  const sourceId = strictText(v.id) || strictText(v.name) || nextFieldId()
  let newId = safeFieldId(sourceId, nextFieldId)
  while (editor.querySelector('[data-field-id="' + newId.replace(/"/g, '\\"') + '"]')) {
    newId = nextFieldId()
  }
  idMap.set(sourceId, newId)
  span.dataset['fieldId'] = newId
  span.dataset['type'] = type
  span.dataset['name'] = strictText(v.name).trim()
  if (type === 'input') {
    span.dataset['refType'] = v.ref || v.refName || v.refId ? 'ref' : v.refType || 'static'
    if (span.dataset['refType'] === 'static') {
      span.dataset['value'] = strictText(v.value !== undefined ? v.value : 0)
    } else if (v.refId) {
      span.dataset['pendingRefId'] = strictText(v.refId)
    } else if (v.refName || v.ref) {
      span.dataset['pendingRefName'] = strictText(v.refName || v.ref)
    }
    span.textContent = span.dataset['value'] || '0'
  } else {
    span.dataset['expr'] = strictText(v.expr)
    span.textContent = '?'
  }
  // Slice-7 round-trip extensions (dataset mirror; display is refreshed by
  // the controller's updateAllFields after the import).
  if (v.latexValue !== undefined) span.dataset['latexValue'] = strictText(v.latexValue)
  if (v.referenceClone) span.dataset['referenceClone'] = 'true'
  if (v.sourceOutputName) span.dataset['sourceOutputName'] = strictText(v.sourceOutputName)
  // Click-to-edit is delegated via the controller's onEditorClick — the
  // reference's per-span listener (L2501) is deliberately not ported.
  return span
}

function resolveImportedRefs(
  fieldMasters: HTMLElement[],
  fieldByName: Map<string, HTMLElement>,
  idMap: Map<string, string>
): void {
  for (const f of fieldMasters) {
    if (f.dataset['type'] !== 'input' || f.dataset['refType'] !== 'ref') continue
    const pendingId = f.dataset['pendingRefId']
    const pendingName = f.dataset['pendingRefName']
    if (pendingId) {
      f.dataset['refId'] = idMap.get(pendingId) || pendingId
      delete f.dataset['pendingRefId']
    } else if (pendingName) {
      const target = fieldByName.get(normaliseName(pendingName))
      if (target) f.dataset['refId'] = target.dataset['fieldId'] ?? ''
      delete f.dataset['pendingRefName']
    }
  }
}

function createInlineNodes(children: InlineNode[] | undefined, ctx: InlineContext): DocumentFragment {
  const frag = ctx.docEl.createDocumentFragment()
  for (const ch of children ?? []) {
    if (ch === null || ch === undefined) continue
    if (typeof ch === 'string' || typeof ch === 'number') {
      frag.appendChild(ctx.docEl.createTextNode(String(ch)))
      continue
    }
    if (('br' in ch && ch.br === true) || ('type' in ch && ch.type === 'br')) {
      frag.appendChild(ctx.docEl.createElement('br'))
      continue
    }
    if ('type' in ch && ch.type === 'link') {
      // v1.1 link (#72). An opaque chip, like a field pill: the whole node is
      // one atom in the DOM, so the label and the target it names cannot be
      // separated by editing.
      frag.appendChild(createLinkChip(ctx.docEl, { target: ch.target, label: ch.label }))
      continue
    }
    if ('text' in ch) {
      frag.appendChild(createTextSpan(ctx.docEl, ch))
      continue
    }
    if ('field' in ch || 'fieldId' in ch) {
      const fieldNode = ch as { field?: string; fieldId?: string }
      const master = fieldNode.fieldId
        ? ctx.fieldById.get(strictText(fieldNode.fieldId))
        : ctx.fieldByName.get(normaliseName(fieldNode.field))
      if (!master) {
        const missing = ctx.docEl.createElement('span')
        missing.textContent = '[NOT FOUND: ' + strictText(fieldNode.field ?? fieldNode.fieldId) + ']'
        missing.style.color = '#ff0000'
        missing.style.fontWeight = '700'
        frag.appendChild(missing)
      } else {
        frag.appendChild(master.cloneNode(true))
      }
      continue
    }
    if ('children' in ch) {
      const span = ctx.docEl.createElement('span')
      span.appendChild(createInlineNodes(ch.children, ctx))
      applyStyle(span, ch.style)
      frag.appendChild(span)
    }
  }
  return frag
}

/**
 * The image-block delete affordance (#44) — a hover-revealed ✕ that removes
 * the whole `.image-block`. Editor chrome like the drag-handle: invisible to
 * the serializer (which reads only `img[data-image-id]`) and hidden during PNG
 * export. Shared by the import renderer and the controller's live insert path
 * so both produce identical markup; the controller wires the click.
 */
export function createImageRemoveButton(docEl: Document): HTMLButtonElement {
  const btn = docEl.createElement('button')
  btn.setAttribute('type', 'button')
  btn.className = 'img-remove'
  btn.setAttribute('contenteditable', 'false')
  btn.setAttribute('aria-label', 'Bild löschen')
  btn.title = 'Bild löschen'
  btn.textContent = '✕'
  return btn
}

function createBlock(
  block: EditorDocumentBlock,
  ctx: InlineContext,
  adapters: ImportAdapters,
  renderTargets: HTMLElement[]
): HTMLElement {
  const docEl = ctx.docEl
  let el: HTMLElement
  if (block.type === 'heading') {
    const lvl = Math.min(2, Math.max(1, Number(block.level || 1)))
    el = docEl.createElement(lvl === 1 ? 'h1' : 'h2')
    el.appendChild(createInlineNodes(block.children ?? [{ text: strictText(block.text) }], ctx))
  } else if (block.type === 'list') {
    el = docEl.createElement(block.ordered ? 'ol' : 'ul')
    for (const item of block.items ?? []) {
      const li = docEl.createElement('li')
      li.appendChild(
        createInlineNodes(
          Array.isArray(item) ? item : item.children ?? [{ text: strictText(item.text) }],
          ctx
        )
      )
      el.appendChild(li)
    }
  } else if (block.type === 'formula') {
    el = docEl.createElement('div')
    el.className = 'formula-block'
    el.setAttribute('draggable', 'true')
    const rawLatex = strictText(block.latex || block.rawLatex)
    const resolved = adapters.resolvePlaceholders(rawLatex)
    const handle = docEl.createElement('span')
    handle.className = 'drag-handle'
    handle.setAttribute('contenteditable', 'false')
    handle.textContent = '❚❚'
    const target = docEl.createElement('div')
    target.className = 'render-target'
    target.setAttribute('contenteditable', 'false')
    target.dataset['rawLatex'] = rawLatex
    target.dataset['latex'] = resolved
    target.textContent = resolved
    el.appendChild(handle)
    el.appendChild(target)
    renderTargets.push(target)
    if (block.caption !== undefined) {
      const cap = docEl.createElement('div')
      cap.className = 'block-caption'
      cap.setAttribute('contenteditable', 'true')
      cap.dataset['ph'] = 'Caption ...'
      const capChildren: InlineNode[] =
        typeof block.caption === 'string'
          ? [{ text: block.caption }]
          : block.caption.children ?? [{ text: strictText(block.caption.text) }]
      cap.appendChild(createInlineNodes(capChildren, ctx))
      el.appendChild(cap)
    }
  } else if (block.type === 'image') {
    // Slice-8 storage-reference image block (reference image branch, L2555 —
    // with the base64/arbitrary `src` replaced by the proxy URL of `imageId`).
    el = docEl.createElement('div')
    el.className = 'image-block'
    el.setAttribute('draggable', 'true')
    const handle = docEl.createElement('span')
    handle.className = 'drag-handle'
    handle.setAttribute('contenteditable', 'false')
    handle.textContent = '❚❚'
    const img = docEl.createElement('img')
    img.src = adapters.imageUrl(block.imageId)
    img.alt = strictText(block.alt)
    img.setAttribute('contenteditable', 'false')
    img.dataset['imageId'] = block.imageId
    el.appendChild(handle)
    el.appendChild(img)
    // Editor-Chrome wie der drag-handle (#44): Lösch-✕, das den ganzen Block
    // entfernt. Für den Serializer unsichtbar (der liest nur img[data-image-id])
    // und beim PNG-Export ausgeblendet (png-export.ts).
    el.appendChild(createImageRemoveButton(docEl))
  } else if (block.type === 'code') {
    // Slice-7 extension: the editor's <pre> blocks (codeblock insert / formatBlock).
    el = docEl.createElement('pre')
    el.textContent = strictText(block.text)
  } else {
    // paragraph — and, matching the reference's default branch (L2560), the
    // fallback for anything unknown (unreachable through the strict schema).
    el = docEl.createElement('p')
    el.appendChild(createInlineNodes(block.children ?? [{ text: strictText(block.text) }], ctx))
    if (!el.childNodes.length) el.appendChild(docEl.createElement('br'))
  }
  applyStyle(el, block.style)
  // Sprungmarke (v1.1, #71): the id has to survive the DOM round-trip, so it
  // rides in the block element's dataset — copied verbatim, never re-derived.
  if (block.anchor) writeBlockAnchor(el, block.anchor)
  return el
}

/**
 * JSON → editor DOM (ported `importEditorJson`, reference L2569). Builds all
 * field masters into the hidden store, then the content blocks before it.
 * Throws a German `Error` on duplicate/colliding variable names. Rendering,
 * library restore and the field refresh are the caller's job — see
 * {@link ImportResult}.
 */
export function importEditorJson(
  doc: LatestEditorDocumentJson,
  editor: HTMLElement,
  adapters: ImportAdapters,
  options?: { replaceExisting?: boolean }
): ImportResult {
  const vars = doc.variables
  const blocks = doc.content
  const replaceExisting = options?.replaceExisting !== false

  validateUniqueImportedVariables(editor, vars, replaceExisting)

  if (replaceExisting) editor.innerHTML = ''

  const idMap = new Map<string, string>()
  const fieldByName = new Map<string, HTMLElement>()
  const fieldById = new Map<string, HTMLElement>()
  const store = getOrCreateHiddenStore(editor)
  const fieldMasters: HTMLElement[] = []

  for (const v of vars) {
    const master = createFieldMaster(v, editor, idMap, adapters.nextFieldId)
    fieldMasters.push(master)
    const name = master.dataset['name']
    if (name) fieldByName.set(normaliseName(name), master)
    const sourceId = strictText(v.id) || (master.dataset['fieldId'] ?? '')
    fieldById.set(sourceId, master)
    fieldById.set(master.dataset['fieldId'] ?? '', master)
    store.appendChild(master)
  }
  resolveImportedRefs(fieldMasters, fieldByName, idMap)

  const ctx: InlineContext = { docEl: editor.ownerDocument, fieldByName, fieldById }
  const renderTargets: HTMLElement[] = []
  for (const block of blocks) {
    const node = createBlock(block, ctx, adapters, renderTargets)
    editor.insertBefore(node, store)
  }

  const libraryLatex =
    doc.library !== undefined
      ? [...doc.library]
      : blocks
          .filter((b) => b.type === 'formula' && b.library !== false)
          .map((b) => strictText(b.type === 'formula' ? b.latex || b.rawLatex : ''))
          .filter((latex) => latex !== '')

  return { renderTargets, libraryLatex }
}

// ── Serializer (newly written) ──────────────────────────────────────────────

function hasKeys(style: EditorTextStyle): boolean {
  return Object.keys(style).length > 0
}

/**
 * Canonical colour: `rgb(r, g, b)` / opaque `rgba(...)` → lowercase
 * `#rrggbb` (browsers and jsdom normalise inline hex colours to rgb, so this
 * is what makes colour round-trips byte-stable). Anything else passes
 * through unchanged.
 */
function canonicalColor(value: string): string {
  if (!value) return ''
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(value)
  if (!m) return value
  if (m[4] !== undefined && Number(m[4]) !== 1) return value
  const hex = (n: string) => Number(n).toString(16).padStart(2, '0')
  return '#' + hex(m[1]!) + hex(m[2]!) + hex(m[3]!)
}

/** Canonical font size: `"18px"` → `18`; everything else stays a string. */
function canonicalFontSize(value: string): number | string {
  const m = /^(\d+(?:\.\d+)?)px$/.exec(value)
  return m ? Number(m[1]) : value
}

/**
 * Canonical style of an element: inline styles plus the semantic tags the
 * editor's execCommands produce (B/STRONG, I/EM, U, S/STRIKE/DEL). Keys are
 * built in a FIXED order — the key order is part of the byte-stability
 * contract. Booleans are emitted as `true` or omitted, never `false` (the
 * importer only acts on truthy values).
 */
function extractStyle(el: HTMLElement): EditorTextStyle {
  const s = el.style
  const tag = el.tagName
  const style: EditorTextStyle = {}
  const color = canonicalColor(s.color)
  if (color) style.color = color
  const backgroundColor = canonicalColor(s.backgroundColor)
  if (backgroundColor) style.backgroundColor = backgroundColor
  if (s.fontSize) style.fontSize = canonicalFontSize(s.fontSize)
  const fontWeight = s.fontWeight
  if (
    tag === 'B' ||
    tag === 'STRONG' ||
    fontWeight === 'bold' ||
    fontWeight === 'bolder' ||
    Number(fontWeight) >= 600
  ) {
    style.bold = true
  }
  if (tag === 'I' || tag === 'EM' || s.fontStyle === 'italic') style.italic = true
  const decoration = s.textDecoration || s.textDecorationLine || ''
  if (tag === 'U' || decoration.includes('underline')) style.underline = true
  if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL' || decoration.includes('line-through')) {
    style.strike = true
  }
  if (s.textAlign) style.align = s.textAlign
  return style
}

function serializeInlineChildren(container: HTMLElement): InlineNode[] {
  const out: InlineNode[] = []
  for (const node of Array.from(container.childNodes)) {
    appendInlineNode(node, out)
  }
  // Canonical empty line: a lone <br> means "no content" — the importer
  // restores the <br> for empty paragraphs (reference L2563).
  if (out.length === 1) {
    const only = out[0]
    if (typeof only === 'object' && only !== null && 'br' in only) return []
  }
  return out
}

function appendInlineNode(node: Node, out: InlineNode[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? ''
    if (text === '') return
    const last = out[out.length - 1]
    if (typeof last === 'string') {
      out[out.length - 1] = last + text // canonical: merge adjacent text
    } else {
      out.push(text)
    }
    return
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return
  const el = node as HTMLElement
  if (el.tagName === 'BR') {
    out.push({ br: true })
    return
  }
  // Transient drag UI / block chrome never belongs in the document JSON.
  if (el.classList.contains('inline-drop-caret') || el.classList.contains('drag-handle')) return
  if (el.classList.contains('input-field') || el.classList.contains('output-field')) {
    out.push({ fieldId: el.dataset['fieldId'] ?? '' })
    return
  }
  if (el.classList.contains(LINK_CHIP_CLASS)) {
    const link = readLinkChip(el)
    // A chip whose dataset does not describe a target is not a link. Falling
    // through leaves its label as ordinary text, which is the honest outcome:
    // the sentence still reads, and nothing unfollowable enters the JSON.
    if (link) {
      // Key order is the byte-stability contract — same order as LinkNodeSchema.
      out.push({ type: 'link', target: link.target, label: link.label })
      return
    }
  }
  const style = extractStyle(el)
  const childNodes = Array.from(el.childNodes)
  const firstChild = childNodes[0]
  if (childNodes.length === 1 && firstChild && firstChild.nodeType === Node.TEXT_NODE) {
    const textNode: { text: string; style?: EditorTextStyle } = {
      text: firstChild.textContent ?? '',
    }
    if (hasKeys(style)) textNode.style = style
    out.push(textNode)
    return
  }
  const children: InlineNode[] = []
  for (const child of childNodes) appendInlineNode(child, children)
  const group: { children: InlineNode[]; style?: EditorTextStyle } = { children }
  if (hasKeys(style)) group.style = style
  out.push(group)
}

/**
 * Attaches the two things every block type carries the same way — its style
 * and its Sprungmarke — in that FIXED order, so `style` and `anchor` always
 * land last and always in that sequence. Key order is part of the
 * byte-stability contract, and the v1.1 schema declares `anchor` in the same
 * final position.
 */
function withBlockMeta<T extends EditorDocumentBlock>(block: T, el: HTMLElement): T {
  const style = extractStyle(el)
  if (hasKeys(style)) (block as { style?: EditorTextStyle }).style = style
  const anchor = readBlockAnchor(el)
  if (anchor) (block as { anchor?: DocumentAnchor }).anchor = anchor
  return block
}

function serializeBlockElement(el: HTMLElement): EditorDocumentBlock {
  const tag = el.tagName
  if (tag === 'H1' || tag === 'H2') {
    return withBlockMeta(
      { type: 'heading', level: tag === 'H1' ? 1 : 2, children: serializeInlineChildren(el) },
      el
    )
  }
  if (tag === 'UL' || tag === 'OL') {
    const items = Array.from(el.children)
      .filter((li) => li.tagName === 'LI')
      .map((li) => serializeInlineChildren(li as HTMLElement))
    return withBlockMeta({ type: 'list', ordered: tag === 'OL', items }, el)
  }
  if (tag === 'PRE') {
    return withBlockMeta({ type: 'code', text: el.textContent ?? '' }, el)
  }
  if (el.classList.contains('formula-block')) {
    const target = el.querySelector<HTMLElement>('.render-target')
    const latex = target?.dataset['rawLatex'] ?? target?.dataset['latex'] ?? ''
    const block: Extract<EditorDocumentBlock, { type: 'formula' }> = { type: 'formula', latex }
    const cap = el.querySelector<HTMLElement>('.block-caption')
    if (cap) block.caption = { children: serializeInlineChildren(cap) }
    return withBlockMeta(block, el)
  }
  if (el.classList.contains('image-block')) {
    // Only data-image-id is read — the src (proxy URL or transient blob:
    // preview) never enters the JSON. Blocks without an id are skipped by
    // serializeEditorState before this runs.
    const img = el.querySelector<HTMLElement>('img[data-image-id]')
    const block: Extract<EditorDocumentBlock, { type: 'image' }> = {
      type: 'image',
      imageId: img?.dataset['imageId'] ?? '',
    }
    const alt = img?.getAttribute('alt') ?? ''
    if (alt) block.alt = alt
    return withBlockMeta(block, el)
  }
  // <p>, generic <div> lines and anything unknown → paragraph.
  return withBlockMeta({ type: 'paragraph', children: serializeInlineChildren(el) }, el)
}

const BLOCK_TAGS = new Set(['H1', 'H2', 'UL', 'OL', 'PRE', 'P', 'DIV', 'BLOCKQUOTE'])

/**
 * Top-level elements {@link serializeEditorState} drops entirely: the hidden
 * field store, transient drag chrome, and an image block that has no storage
 * reference yet.
 */
function isDroppedTopLevel(el: HTMLElement): boolean {
  if (el.id === 'hiddenFields') return true
  if (el.classList.contains('drop-indicator') || el.classList.contains('inline-drop-caret')) {
    return true
  }
  // Image block still uploading (blob: preview, no data-image-id yet) — it has
  // no storage reference to persist. Saves are blocked while uploads are in
  // flight (slice-8 decision), so this only covers the failed-upload window
  // before the block is removed. Must be tested before the block-tag branch:
  // the block is a DIV.
  return el.classList.contains('image-block') && !el.querySelector('img[data-image-id]')
}

/** Tag/class test for "this element is a block", ignoring the drop rules above. */
function hasBlockShape(el: HTMLElement): boolean {
  return BLOCK_TAGS.has(el.tagName) || el.classList.contains('formula-block')
}

/**
 * Whether a top-level editor element ends up in the JSON as a block of its
 * own — the complete test, drop rules included.
 *
 * Exported because a Sprungmarke may only be stamped on something that
 * survives a save (#71). Stamping one on a stray inline element, or on an
 * image block whose upload has not landed, would put an anchor in the DOM that
 * the very next serialization discards — the author would see a mark that
 * quietly does not exist.
 */
export function serializesAsOwnBlock(el: HTMLElement): boolean {
  return !isDroppedTopLevel(el) && hasBlockShape(el)
}

/**
 * A top-level node {@link serializeEditorState} folds into a paragraph rather
 * than emitting as itself: bare text, or an inline element with no block
 * shape. Dropped elements are NOT stray — they leave the document entirely.
 */
function isStrayTopLevel(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) return true
  if (node.nodeType !== Node.ELEMENT_NODE) return false
  const el = node as HTMLElement
  return !hasBlockShape(el) && !isDroppedTopLevel(el)
}

/**
 * Wraps the contiguous run of stray top-level nodes around `node` into the
 * `<p>` the serializer would have folded them into anyway, and returns it.
 * `null` when `node` is not a stray top-level child of `editor` — an existing
 * block, the hidden field store, drag chrome.
 *
 * This exists for the first line of an empty document (#93): a contenteditable
 * leaves it as a bare text node, so it has no element to carry a Sprungmarke
 * and `serializesAsOwnBlock` rightly refuses it — while the author can plainly
 * see the caret sitting in it. Promoting is the honest resolution: the run
 * already serializes as exactly one paragraph, so making that paragraph real
 * changes the saved document not at all, and the line becomes markable.
 *
 * The run is bounded by any non-stray sibling, dropped ones included. That is
 * marginally stricter than the serializer, which lets a stray run span the
 * hidden field store — but folding `#hiddenFields` into a paragraph would
 * publish the hidden fields as visible content, so the run stops there.
 *
 * Caller beware: moving a node detaches every live Range boundary inside it
 * (DOM "remove" steps re-point them at the old parent). Re-establish the caret
 * from a node/offset pair captured before the call.
 */
export function promoteStrayRunToBlock(editor: HTMLElement, node: Node): HTMLElement | null {
  if (node.parentNode !== editor || !isStrayTopLevel(node)) return null

  let first = node
  while (first.previousSibling && isStrayTopLevel(first.previousSibling)) {
    first = first.previousSibling
  }
  let last = node
  while (last.nextSibling && isStrayTopLevel(last.nextSibling)) {
    last = last.nextSibling
  }

  const block = (editor.ownerDocument ?? document).createElement('p')
  editor.insertBefore(block, first)
  let cursor: Node | null = first
  while (cursor) {
    const next: Node | null = cursor === last ? null : cursor.nextSibling
    block.appendChild(cursor)
    cursor = next
  }
  return block
}

/**
 * Deterministic variable order: fields with an inline (visible) occurrence
 * first, by first occurrence in content order, then hidden-store-only fields
 * in store order — exactly the order a subsequent import reproduces, which
 * makes the ordering a fixed point of export → import → export.
 */
function serializeVariables(editor: HTMLElement): EditorDocumentVariable[] {
  const hidden = editor.querySelector('#hiddenFields')
  const all = Array.from(editor.querySelectorAll<HTMLElement>('.input-field, .output-field'))
  const inline = all.filter((el) => !(hidden && hidden.contains(el)))
  const hiddenOnly = all.filter((el) => hidden !== null && hidden.contains(el))
  const seen = new Set<string>()
  const out: EditorDocumentVariable[] = []
  for (const el of [...inline, ...hiddenOnly]) {
    const id = el.dataset['fieldId'] ?? ''
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(variableFromElement(el, id))
  }
  return out
}

function variableFromElement(el: HTMLElement, id: string): EditorDocumentVariable {
  const type = el.dataset['type'] === 'output' ? 'output' : 'input'
  const v: EditorDocumentVariable = { id, type }
  const name = el.dataset['name'] ?? ''
  if (name) v.name = name
  if (type === 'input') {
    const refType = el.dataset['refType'] === 'ref' ? 'ref' : 'static'
    v.refType = refType
    if (refType === 'static') {
      v.value = el.dataset['value'] ?? '0'
    } else if (el.dataset['refId'] !== undefined) {
      v.refId = el.dataset['refId']
    }
  } else {
    v.expr = el.dataset['expr'] ?? ''
  }
  if (el.dataset['latexValue'] !== undefined) v.latexValue = el.dataset['latexValue']
  if (el.dataset['referenceClone'] === 'true') v.referenceClone = true
  const sourceOutputName = el.dataset['sourceOutputName']
  if (sourceOutputName) v.sourceOutputName = sourceOutputName
  return v
}

/**
 * Editor DOM → versioned JSON. `library` is the current formula-library
 * LaTeX list (the controller reads it from the sidebar items; the library
 * lives outside the editor element).
 */
export function serializeEditorState(
  editor: HTMLElement,
  library: string[]
): LatestEditorDocumentJson {
  const content: EditorDocumentBlock[] = []
  let pendingInline: InlineNode[] = []

  const flushInline = () => {
    if (pendingInline.length === 0) return
    content.push({ type: 'paragraph', children: pendingInline })
    pendingInline = []
  }

  for (const node of Array.from(editor.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      // Stray top-level text (contenteditable quirk) → canonical paragraph.
      const text = node.textContent ?? ''
      if (text.trim() !== '') appendInlineNode(node, pendingInline)
      continue
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue
    const el = node as HTMLElement
    if (isDroppedTopLevel(el)) continue
    if (hasBlockShape(el)) {
      flushInline()
      content.push(serializeBlockElement(el))
      continue
    }
    // Stray top-level inline element (pill, span, <br>, …) → collect into a paragraph.
    appendInlineNode(el, pendingInline)
  }
  flushInline()

  return {
    version: LATEST_DOCUMENT_JSON_VERSION,
    variables: serializeVariables(editor),
    content,
    library: [...library],
  }
}

// ── Image-reference helpers (slice 8, #36) ──────────────────────────────────

/**
 * The `editor_images` ids referenced by a document's image blocks, deduped,
 * in content order. `updateEditorDraft` uses this for save-time
 * reconciliation: rows of the draft that are no longer referenced are deleted
 * together with their storage objects.
 */
export function collectReferencedImageIds(doc: EditorDocumentJson): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const block of doc.content) {
    if (block.type !== 'image' || seen.has(block.imageId)) continue
    seen.add(block.imageId)
    out.push(block.imageId)
  }
  return out
}

// ── Sprungmarken of a published document (#72) ──────────────────────────────

/**
 * The Sprungmarken a document offers as link targets, in content order.
 *
 * This is what the link picker lists beneath a document — read out of the
 * published snapshot itself, which is why linking needs no anchor table and no
 * index (spec #63 §6). Takes a document at the NEWEST version because only
 * v1.1 blocks can carry an anchor; callers come through `readDocumentJson`,
 * which upgrades.
 *
 * Duplicate ids are dropped rather than listed twice. The editor's anchor
 * registry makes them impossible on the authoring side, but a snapshot is
 * untrusted storage, and offering one link target under two names would be a
 * picker that lies.
 */
export function collectDocumentAnchors(doc: LatestEditorDocumentJson): DocumentAnchor[] {
  const seen = new Set<string>()
  const out: DocumentAnchor[] = []
  for (const block of doc.content) {
    const anchor = block.anchor
    if (!anchor || seen.has(anchor.id)) continue
    seen.add(anchor.id)
    out.push(anchor)
  }
  return out
}

/**
 * Canonical empty document — the content of the implicit „Unbenannt" anchor
 * draft that `uploadEditorImage` creates when an image is inserted before the
 * first save (an anchor row only, never content autosave).
 */
export function emptyEditorDocumentJson(): LatestEditorDocumentJson {
  return { version: LATEST_DOCUMENT_JSON_VERSION, variables: [], content: [], library: [] }
}

/**
 * Attaches save-time metadata to a serialized document (slice 10, #38).
 *
 * `serializeEditorState` stays meta-free — its export→import→export
 * byte-stability contract must keep holding, and the importer ignores meta —
 * so the React shell injects the ExportBar's Term field here right before
 * stringifying the save payload. A blank term returns the document unchanged
 * (no empty `meta` object is ever emitted).
 */
export function withDocumentMeta(
  doc: LatestEditorDocumentJson,
  term: string
): LatestEditorDocumentJson {
  const trimmed = term.trim()
  if (!trimmed) return doc
  return { ...doc, meta: { term: trimmed } }
}
