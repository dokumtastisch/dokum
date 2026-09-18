/**
 * Imperative vanilla-TS core of the LaTeX editor (PRD #28, Approach C).
 *
 * Ported 1:1 from the standalone reference file
 * latexEditor/latex_editor_FIXED_JSON_IMPORT_COMPLETE_OUTPUT_AS_INPUT_LATEX_FIX.htm.html.
 * Slice-1 functions come from the base script (none of the seven patch
 * layers override them). Slice 3 (#31) ported the LaTeX pipeline, slice 4
 * (#32) the formula library sidebar and block drag & drop, slice 5 (#33) the
 * Input/Output field system in normal text; the consolidated (last-wins)
 * owners are:
 *   - modal, preview, codeblock insert, render, delete, click-to-edit,
 *     block insertion, textarea colour wrapping — base script L747–1071;
 *   - `insertLatexRendered` — the "Editing an existing LaTeX formula updates
 *     it" patch layer (L2647): the edited block and its previous raw LaTeX
 *     must be captured BEFORE closeLatexModal() nulls them (the base version
 *     read the block afterwards, so editing inserted duplicates — that patch
 *     is the fix), and the edit path syncs the library entry;
 *   - `addToLibrary` — base script L1074–1130, with the library-item
 *     dragstart consolidated to the same patch's `ensureDrag` behavior (its
 *     last word): the drag payload reads `dataset.latex` at drag time, so
 *     in-place library syncs never drag stale LaTeX. The dedup/sync
 *     decisions live in library-sync.ts (pure, tested);
 *   - `syncFormulaLibraryAfterEdit` — defined only in that patch (L2647);
 *   - block drag & drop, inline drop caret, `insertFormulaFromLibraryAt` —
 *     base script L1966–2092 / L1132–1168, never patched;
 *   - field system: value/display decisions live in field-resolver.ts (pure,
 *     tested — consolidation notes there). On the DOM side the FINAL PATCH
 *     versions own `renderVariableList` (L2216), `cloneFieldToDropPosition`
 *     with `makeVisibleInputClone`/`makeInputReferenceToOutput`/
 *     `insertAtDrop` (L2166–2213 — they supersede the base L2096 entirely,
 *     including its hidden-store move logic), the capture-phase field-drop
 *     handlers (L2233–2235), `convertTypedFieldPlaceholders` and the
 *     1-second sweep (L2280–2297). The field modal, `makeFieldSpan`,
 *     `insertNodeAtCursor`, `syncFieldClones` and the hidden store are base
 *     script (L1712–1955), with the unique-name patch (L2653) inlined ahead
 *     of the base save. Deviation (approved in #33 planning): pill
 *     click-to-edit is DELEGATED via onEditorClick instead of per-span
 *     listeners — same behavior, and browser-cloned pills stay clickable;
 *   - `[input:x]`/`[output:x]` resolution inside LaTeX (slice 6, #34) —
 *     `resolveFieldPlaceholders` of the final patch layer
 *     (`patch-output-as-input-latex-fix-v1`, L2698) via field-resolver.ts,
 *     which also subsumes the `*` → `\,\cdot\,` display patch (L2641); the
 *     DOM side here is only the `fieldGraph.setLatexValue` write-back
 *     adapter and the `resolveForDisplay` seam;
 *   - image insertion (slice 8, #36) — file picker `handleImageSelect`
 *     (L1170) and the Strg+V paste handler (L1429), base script, never
 *     patched. Approved deviation: images upload to private storage via the
 *     `uploadImage` hook and render through the signed-URL proxy route —
 *     never as base64 (PRD hard constraint; details at insertImageFromFile);
 *   - JSON import modal (slice 9, #37) — the "BIG FEATURE: JSON import"
 *     script (L2306–2623) with its `importEditorJson` wrapper patch
 *     (L2745–2752) inlined: `importDocument` runs the ported importer
 *     (document-json.ts) and then `reRenderAllLatexFormulas` — the port of
 *     `reRenderAllLatexFormulasOutputInputAware` (L2731–2743), deferred from
 *     slice 6. Deviation (approved in #37 planning): the modal validates
 *     pasted JSON against the strict DocumentJsonSchema at the boundary
 *     (operator story 34) instead of the reference's lenient any-object
 *     import; errors surface via window.alert as in the reference.
 *
 * React renders the mount container childless and never reconciles inside it;
 * this controller owns the entire subtree (export area, contenteditable
 * surface, LaTeX modal, listeners). `document.execCommand` is kept
 * deliberately for behavioral parity with the standalone editor.
 *
 * Browser-only module — must never import the DAL or other server-only code.
 */

import { ALLOWED_IMAGE_MIMES, MAX_FILE_SIZE_BYTES, editorImageUrl } from '@/lib/constants'
import {
  classifyTypedPlaceholder,
  fieldDisplay,
  findDuplicateName,
  getFieldValue,
  resolveFieldPlaceholders,
  type FieldData,
  type FieldGraph,
  type LineToken,
} from './field-resolver'
import {
  createAnchorRegistry,
  clearBlockAnchor,
  readBlockAnchor,
  writeBlockAnchor,
} from './anchors'
import {
  LINK_CHIP_SELECTOR,
  createLinkChip,
  readLinkChip,
  writeLinkChip,
  type LinkPickRequest,
  type LinkPickResult,
} from './links'
import {
  JSON_IMPORT_EXAMPLE,
  createImageRemoveButton,
  importEditorJson,
  promoteStrayRunToBlock,
  serializesAsOwnBlock,
  serializeEditorState,
  type LatestEditorDocumentJson,
} from './document-json'
import { readDocumentJson } from './document-version'
import { cleanupLatex } from './latex-display'
import { librarySyncAction, shouldAddToLibrary } from './library-sync'
import { loadMathJax } from './mathjax-loader'
import { formatValue } from './number-format'
import { exportAreaToPngBlob, type PngExportOptions } from './png-export'

export interface StyleObject {
  color?: string
  backgroundColor?: string
  fontSize?: string
  fontWeight?: string
}

/**
 * Server seams of the controller (slice 8, #36). The React shell wires them
 * to server actions; the controller itself must stay free of server imports.
 */
export interface EditorControllerHooks {
  /**
   * Uploads an image file to private storage (creating the implicit
   * „Unbenannt" anchor draft server-side when needed) and resolves with the
   * `editor_images` id the document JSON will reference.
   */
  uploadImage(file: File): Promise<{ ok: true; imageId: string } | { ok: false; error: string }>
  /**
   * Opens the link target picker (#72) and resolves with what the author
   * chose, or `null` when they cancelled.
   *
   * A hook rather than a controller-owned modal because the picker's tree is
   * SERVER data — published Kurse → Einheiten → Aufgaben, plus a document
   * level fetched lazily per Aufgabe — and the controller must stay free of
   * server imports. It is the same seam `uploadImage` uses, for the same
   * reason.
   */
  pickLinkTarget(request: LinkPickRequest): Promise<LinkPickResult | null>
}

/**
 * Optional callbacks the React shell wires to component state. Unlike the
 * server `hooks`, these carry no side effects into the controller — they let
 * React mirror editor state that lives outside the contenteditable surface.
 */
export interface EditorControllerCallbacks {
  /**
   * Fired on every editor selectionchange with the effective font size at the
   * selection anchor as an integer px string (e.g. `"18"`), or `""` when it
   * can't be determined. Drives the toolbar size dropdown (#43).
   */
  onSelectionFontSize?: (px: string) => void
}

export interface EditorController {
  /** `document.execCommand` wrapper (bold, italic, lists, alignment, …). */
  exec(cmd: string, value?: string): void
  /** Block format via execCommand: H1 | H2 | P | PRE. */
  formatBlock(tag: string): void
  /**
   * Wraps the selection in a styled span (or an empty caret span). While the
   * LaTeX modal's textarea is focused, colour/highlight wrap the textarea
   * selection in `\textcolor{#…}{…}` / `\colorbox{#…}{…}` instead.
   */
  applyStyles(styles: StyleObject): void
  /** Font size in px (string from the toolbar select); no-op on ''. */
  applyFontSize(px: string): void
  /** Style template: color + size + optional bold. */
  applyTemplate(color: string, px: number, bold: boolean): void
  /**
   * Removes the highlight (`background-color`) from the styled spans touched
   * by the current selection (or, when collapsed, the highlighted span under
   * the cursor) and unwraps any span left with no inline style. No-op while
   * the LaTeX textarea is focused.
   */
  clearHighlight(): void
  /**
   * Snapshots the current editor selection into internal state — the saved
   * range is what block insertion (LaTeX modal, later the image file
   * dialog) anchors to.
   */
  saveSelection(): void
  /** Opens the LaTeX modal to insert a new formula („LaTeX einfügen"). */
  openLatexModal(): void
  /**
   * „Input"-Toolbar-Button: inserts an amber Input pill at the cursor (or,
   * while the LaTeX textarea is focused, parks the field in the hidden store
   * and inserts a `[input:name]` placeholder after the modal save) and opens
   * the field modal. Cancelling the modal removes the fresh field again.
   */
  insertInputField(): void
  /** „Output"-Toolbar-Button — blue computed pill; same modal flow as insertInputField(). */
  insertOutputField(): void
  /**
   * „Sprungmarke"-Toolbar-Button (#71): marks the block the cursor sits in as
   * a jump target other documents can link to, asking for its name.
   *
   * On an already-marked block the prompt is pre-filled with the current name
   * and doubles as rename (the opaque id is KEPT — links pointing here must
   * survive a rename) and as unmark (an emptied name removes the mark).
   */
  markAnchor(): void
  /**
   * „Link"-Toolbar-Button (#72): opens the target picker and inserts the
   * chosen link as a chip at the cursor, replacing the selected text — which
   * becomes the link's label.
   *
   * With the caret inside an existing chip it re-targets that one instead. The
   * ordinary way to edit a link is to CLICK its chip, which routes here too:
   * the chip is `contenteditable="false"`, so the caret cannot usually be put
   * inside it.
   */
  insertLink(): void
  /** „Editor zurücksetzen" — clears all content after a confirm dialog. */
  resetEditor(): void
  /**
   * „Bild einfügen"-Toolbar-Button / Strg+V (slice 8, #36): inserts a visible
   * `.image-block` immediately (blob: preview — no base64 ever enters the
   * DOM) and uploads the file through the `uploadImage` hook; on success the
   * block points at the signed-URL proxy route, on failure it is removed
   * again. Invalid type/size → German alert, nothing inserted.
   */
  insertImageFromFile(file: File, alt?: string): void
  /**
   * Serialises the live document (blocks, field state, formula library) to
   * versioned JSON — the draft-save payload (slice 7, #35).
   */
  exportDocument(): LatestEditorDocumentJson
  /**
   * Replaces the editor content and the formula library with a saved
   * document (draft load, slice 7). Resolves once every formula is
   * MathJax-rendered and the field state is refreshed.
   */
  loadDocument(doc: LatestEditorDocumentJson): Promise<void>
  /**
   * „Add JSON"-Toolbar-Button (slice 9, #37): öffnet das JSON-Import-Modal
   * (Textarea, „Beispiel laden", Ersetzen/Anhängen-Checkbox). Import läuft
   * über die strikte DocumentJsonSchema-Validierung und `importDocument`.
   */
  openJsonImportModal(): void
  /**
   * PNG-Export (slice 10, #38): rasterises every MathJax SVG at 2×, renders
   * the export area with html2canvas (loaded as a code-split chunk on first
   * use) and resolves with the PNG Blob — consumed by „Als PNG
   * herunterladen" and (slice 11) by publishing. The editor DOM is fully
   * restored on success and failure. `scale` (default 2) is the html2canvas
   * render scale; slice 11's reduced-resolution fallback passes 1.
   */
  exportToPng(options?: PngExportOptions): Promise<Blob>
  /** Removes document-level listeners and empties the mount container. */
  destroy(): void
}

const PLACEHOLDER_TEXT = 'Hier Text eingeben ...'

const PREVIEW_PLACEHOLDER_HTML =
  '<span style="color:#9aa3af; font-size:13px;">Vorschau erscheint hier ...</span>'

function escapeHtml(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** `err.message || String(err)` — MathJax's TexError is message-shaped but no Error instance. */
function errorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const message = (err as { message: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return String(err)
}

export function createEditorController(
  container: HTMLElement,
  hooks: EditorControllerHooks,
  callbacks: EditorControllerCallbacks = {}
): EditorController {
  // --- Static skeleton (imperative DOM; the React reconciler never sees it) ---
  // The LaTeX modal is part of the skeleton (PRD: modals stay DOM-driven).
  // It must live inside the container so the `.latex-editor #latexOverlay`
  // styles apply; position:fixed detaches it visually anyway. The reference
  // markup's inline `width:680px` is intentionally not ported — the
  // consolidated editor.css owns the width (`min(720px, 92vw)`, the
  // layout-refresh layer's last word, which carried `!important`).
  // Sidebar markup ← reference L589–605: the "Variablen" section first, then
  // the formula library (whose heading carries the reference's inline
  // margin-top:18px). The field modal ← reference L629–667; unlike
  // #latexOverlay it is a regular BLOCKING overlay (no pointer-events
  // override in editor.css), so its background click-to-close is live.
  container.innerHTML =
    '<div class="workspace">' +
    '<div id="exportArea">' +
    '<div class="topbar"></div>' +
    '<div class="editor-scroll" id="editorScroll">' +
    '<div id="editor" contenteditable="true"></div>' +
    '</div>' +
    '</div>' +
    '<aside id="formulaLibrary">' +
    '<h3>Variablen</h3>' +
    '<div id="variableList">' +
    '<div class="library-empty">Noch keine Felder. Füge Input/Output über die Toolbar hinzu.</div>' +
    '</div>' +
    '<h3 style="margin-top:18px;">Formel-Bibliothek</h3>' +
    '<div id="libraryList">' +
    '<div class="library-empty">Noch keine Formeln. Füge welche über &laquo;LaTeX einfügen&raquo; hinzu — sie erscheinen hier und können per Drag&amp;Drop in den Editor gezogen werden.</div>' +
    '</div>' +
    '</aside>' +
    '</div>' +
    '<div class="modal-overlay" id="latexOverlay">' +
    '<div class="modal">' +
    '<h2 id="latexModalTitle">LaTeX-Formel einfügen</h2>' +
    '<textarea id="latexInput" placeholder="z.B. \\begin{aligned} ... \\end{aligned}  oder  $$ a^2+b^2=c^2 $$&#10;Platzhalter für Felder: [input:name] oder [output:name]"></textarea>' +
    '<div style="font-size:11px; color:#6b7280; margin-top:4px;">' +
    'Tipp: Markiere Text und nutze die <b>Haupttoolbar</b> für Farbe (→ <code>\\textcolor</code>), bzw. <b>Input/Output</b> direkt dort — wird an Cursor-Position eingefügt.' +
    '</div>' +
    '<div id="latexPreviewBox" style="margin-top:12px; min-height:70px; max-height:200px; overflow:auto; background:#f8fafc; border:1px solid #e0e6ee; border-radius:10px; padding:14px; display:flex; align-items:center; justify-content:center;">' +
    PREVIEW_PLACEHOLDER_HTML +
    '</div>' +
    '<div class="modal-actions">' +
    '<button type="button" class="ghost" id="latexDeleteBtn" style="margin-right:auto; color:#991b1b; display:none;">Löschen</button>' +
    '<button type="button" class="ghost" id="latexCancelBtn">Abbrechen</button>' +
    '<button type="button" id="latexCodeblockBtn">Als Codeblock</button>' +
    '<button type="button" class="primary" id="latexApplyBtn">Gerendert einfügen</button>' +
    '</div>' +
    '</div>' +
    '</div>' +
    '<div class="modal-overlay" id="fieldOverlay">' +
    '<div class="modal">' +
    '<h2 id="fieldModalTitle">Feld bearbeiten</h2>' +
    '<div style="display:flex; flex-direction:column; gap:10px;">' +
    '<label style="font-size:13px;color:#374151;">Name <span id="nameRequiredHint" style="color:#991b1b;"></span>' +
    '<input type="text" id="fieldName" style="display:block; width:100%; margin-top:4px; padding:6px 8px; border:1px solid #d7dce2; border-radius:6px;" placeholder="z.B. x, preis, ergebnis">' +
    '</label>' +
    '<div id="fieldInputOptions">' +
    '<label style="font-size:13px;color:#374151;">Typ' +
    '<select id="fieldRefType" style="display:block; width:100%; margin-top:4px; padding:6px 8px; border:1px solid #d7dce2; border-radius:6px;">' +
    '<option value="static">Statischer Wert</option>' +
    '<option value="ref">Referenz auf Output-Feld</option>' +
    '</select>' +
    '</label>' +
    '<label id="fieldValueLabel" style="font-size:13px;color:#374151; display:block; margin-top:8px;">Wert' +
    '<input type="text" id="fieldValue" style="display:block; width:100%; margin-top:4px; padding:6px 8px; border:1px solid #d7dce2; border-radius:6px;" placeholder="z.B. 2">' +
    '</label>' +
    '<label id="fieldRefLabel" style="font-size:13px;color:#374151; display:none; margin-top:8px;">Referenz auf' +
    '<select id="fieldRefTarget" style="display:block; width:100%; margin-top:4px; padding:6px 8px; border:1px solid #d7dce2; border-radius:6px;"></select>' +
    '</label>' +
    '</div>' +
    '<div id="fieldOutputOptions" style="display:none;">' +
    '<div id="outputAutoHint" style="font-size:12px; color:#374151; background:#f1f4f8; border-radius:6px; padding:8px;">' +
    'Die Formel wird automatisch aus dem Text davor erkannt: zwischen <code>:</code> und <code>=</code>, zwischen zwei <code>=</code>, oder zwischen Zeilenanfang und <code>=</code>.<br>' +
    'Beispiel: „Berechnung: 2+4*3 = <b>[Output]</b>“ → rechnet <code>2+4*3</code>.' +
    '</div>' +
    '<label id="fieldExprLabel" style="font-size:13px;color:#374151; display:block; margin-top:8px;">Expression manuell überschreiben (optional)' +
    '<input type="text" id="fieldExpr" style="display:block; width:100%; margin-top:4px; padding:6px 8px; border:1px solid #d7dce2; border-radius:6px; font-family:Consolas, monospace;" placeholder="leer lassen für Auto-Erkennung">' +
    '</label>' +
    '<div style="font-size:11px; color:#6b7280; margin-top:4px;">Verfügbare Variablen: <span id="fieldAvailVars">—</span></div>' +
    '</div>' +
    '</div>' +
    '<div class="modal-actions">' +
    '<button type="button" class="ghost" id="fieldDeleteBtn" style="margin-right:auto; color:#991b1b;">Löschen</button>' +
    '<button type="button" class="ghost" id="fieldCancelBtn">Abbrechen</button>' +
    '<button type="button" class="primary" id="fieldSaveBtn">Übernehmen</button>' +
    '</div>' +
    '</div>' +
    '</div>' +
    // JSON-Import-Modal (slice 9, #37) ← reference L2336–2347. Like the field
    // overlay it is a regular BLOCKING overlay, so background click-to-close
    // (reference L2349) is live. The reference built it lazily on first open
    // (ensureJsonModal); the port keeps it in the static skeleton like the
    // other modals — behavior-identical, destroy() covers it for free.
    '<div class="modal-overlay" id="jsonOverlay">' +
    '<div class="modal">' +
    '<h2>JSON importieren</h2>' +
    '<textarea id="jsonInput" spellcheck="false" placeholder="JSON hier einfügen ..."></textarea>' +
    '<div class="json-row"><label><input type="checkbox" id="jsonReplaceExisting" checked> Bestehenden Editor-Inhalt ersetzen</label></div>' +
    '<div id="jsonImportHelp">Erwartete Struktur: <code>{ version, variables, content }</code>. Unterstützt u.a. <code>paragraph</code>, <code>heading</code>, <code>list</code>, <code>formula</code>, <code>image</code>, Inline-Text mit <code>style</code> und Feldreferenzen über <code>{ field: "Name" }</code>.</div>' +
    '<div class="modal-actions">' +
    '<button class="ghost" type="button" id="jsonCancelBtn">Abbrechen</button>' +
    '<button type="button" id="jsonExampleBtn">Beispiel laden</button>' +
    '<button class="primary" type="button" id="jsonImportBtn">Importieren</button>' +
    '</div>' +
    '</div>' +
    '</div>'

  const editor = container.querySelector<HTMLElement>('#editor')!
  editor.dataset['placeholder'] = PLACEHOLDER_TEXT

  const exportArea = container.querySelector<HTMLElement>('#exportArea')!
  const editorScroll = container.querySelector<HTMLElement>('#editorScroll')!
  const libraryList = container.querySelector<HTMLElement>('#libraryList')!
  const variableList = container.querySelector<HTMLElement>('#variableList')!
  const latexOverlay = container.querySelector<HTMLElement>('#latexOverlay')!
  const latexModalTitle = container.querySelector<HTMLElement>('#latexModalTitle')!
  const latexInput = container.querySelector<HTMLTextAreaElement>('#latexInput')!
  const latexPreviewBox = container.querySelector<HTMLElement>('#latexPreviewBox')!
  const latexDeleteBtn = container.querySelector<HTMLButtonElement>('#latexDeleteBtn')!
  const latexCancelBtn = container.querySelector<HTMLButtonElement>('#latexCancelBtn')!
  const latexCodeblockBtn = container.querySelector<HTMLButtonElement>('#latexCodeblockBtn')!
  const latexApplyBtn = container.querySelector<HTMLButtonElement>('#latexApplyBtn')!
  const fieldOverlay = container.querySelector<HTMLElement>('#fieldOverlay')!
  const fieldModalTitle = container.querySelector<HTMLElement>('#fieldModalTitle')!
  const fieldNameInput = container.querySelector<HTMLInputElement>('#fieldName')!
  const nameRequiredHint = container.querySelector<HTMLElement>('#nameRequiredHint')!
  const fieldInputOptions = container.querySelector<HTMLElement>('#fieldInputOptions')!
  const fieldRefTypeSelect = container.querySelector<HTMLSelectElement>('#fieldRefType')!
  const fieldValueLabel = container.querySelector<HTMLElement>('#fieldValueLabel')!
  const fieldValueInput = container.querySelector<HTMLInputElement>('#fieldValue')!
  const fieldRefLabel = container.querySelector<HTMLElement>('#fieldRefLabel')!
  const fieldRefTarget = container.querySelector<HTMLSelectElement>('#fieldRefTarget')!
  const fieldOutputOptions = container.querySelector<HTMLElement>('#fieldOutputOptions')!
  const outputAutoHint = container.querySelector<HTMLElement>('#outputAutoHint')!
  const fieldExprInput = container.querySelector<HTMLInputElement>('#fieldExpr')!
  const fieldAvailVars = container.querySelector<HTMLElement>('#fieldAvailVars')!
  const fieldDeleteBtn = container.querySelector<HTMLButtonElement>('#fieldDeleteBtn')!
  const fieldCancelBtn = container.querySelector<HTMLButtonElement>('#fieldCancelBtn')!
  const fieldSaveBtn = container.querySelector<HTMLButtonElement>('#fieldSaveBtn')!
  const jsonOverlay = container.querySelector<HTMLElement>('#jsonOverlay')!
  const jsonInput = container.querySelector<HTMLTextAreaElement>('#jsonInput')!
  const jsonReplaceExisting = container.querySelector<HTMLInputElement>('#jsonReplaceExisting')!
  const jsonCancelBtn = container.querySelector<HTMLButtonElement>('#jsonCancelBtn')!
  const jsonExampleBtn = container.querySelector<HTMLButtonElement>('#jsonExampleBtn')!
  const jsonImportBtn = container.querySelector<HTMLButtonElement>('#jsonImportBtn')!

  // Mutable controller state. Kept as an object so drag & drop and later
  // slices (image insertion) share the same saved selection.
  const state: { savedRange: Range | null } = { savedRange: null }

  // null = neue Formel, sonst: bestehender .formula-block zum Bearbeiten
  let editingFormulaBlock: HTMLElement | null = null
  let latexPreviewTimer: ReturnType<typeof setTimeout> | undefined
  // Tracker: welcher Editor war zuletzt aktiv (Haupteditor oder LaTeX-Textarea)
  let lastFocused: 'editor' | 'latex' = 'editor'

  // --- Input/Output-Feld-Zustand (slice 5, #33; reference L844–846, L1459, L1804) ---
  let fieldCounter = 0
  // null = kein Feld-Modal offen, sonst: field-id des bearbeiteten Feldes
  let editingFieldId: string | null = null
  // true → Feld wurde gerade neu erstellt und ist noch unbestätigt
  let isFieldBeingCreated = false
  // true → nach Field-Modal-Save Platzhalter in die LaTeX-Textarea einfügen
  let pendingLatexFieldInsert = false
  // Cursor-Position in der Textarea vor Öffnung des Feld-Modals
  let savedLatexTextareaPos: { start: number; end: number } | null = null

  // --- Sprungmarken (#71) ---
  // Opaque anchor ids, minted exactly like field ids so a fresh mount can
  // never re-issue an id an already-loaded document is using.
  let anchorCounter = 0
  function nextAnchorId(): string {
    return 'anc_' + Date.now().toString(36) + '_' + ++anchorCounter
  }
  // The uniqueness guard: ordinary editing (paste, block drop, a
  // contenteditable Enter that splits a block) duplicates a marked block's id,
  // and two blocks answering to one link is a silently wrong document.
  const anchorRegistry = createAnchorRegistry(editor, nextAnchorId)

  // #92: a formula or image block holds no caret. Its content is
  // contenteditable="false", so clicking it opens the „Formel bearbeiten"-Modal
  // instead of placing a cursor, and ArrowDown steps straight over it — which
  // left the ⚓ button with no way to reach the two block kinds another document
  // most wants to link to. A click (as opposed to a drag) on the block's ❚❚
  // handle selects the block, and the selection is what ⚓ then acts on.
  //
  // Selecting is deliberately not a browser selection: putting a Range around
  // an uneditable block would make the next keystroke replace it. This is a
  // plain marker class the ⚓ button reads, cleared by the next caret move,
  // keystroke or Escape.
  let selectedBlock: HTMLElement | null = null

  function selectBlock(block: HTMLElement | null) {
    if (selectedBlock === block) return
    selectedBlock?.classList.remove('block-selected')
    selectedBlock = block
    block?.classList.add('block-selected')
  }

  // Warm-up: the reference file loaded MathJax at page load (CDN <script> in
  // <head>); the port starts the bundled dynamic import when the editor
  // mounts. Render paths still await loadMathJax(), where a failure surfaces
  // as the German error box.
  void loadMathJax().catch(() => {})

  function exec(cmd: string, value?: string) {
    editor.focus()
    document.execCommand(cmd, false, value)
  }

  function ensureEditorSelection(): Selection | null {
    editor.focus()
    let sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || !editor.contains(sel.anchorNode)) {
      const r = document.createRange()
      r.selectNodeContents(editor)
      r.collapse(false)
      sel = window.getSelection()
      if (!sel) return null
      sel.removeAllRanges()
      sel.addRange(r)
    }
    return sel
  }

  function applyStyles(styleObj: StyleObject) {
    if (isLatexActive()) {
      if (styleObj.color) {
        applyLatexColor(styleObj.color)
        return
      }
      if (styleObj.backgroundColor) {
        applyLatexHighlight(styleObj.backgroundColor)
        return
      }
      // Größe/Bold im LaTeX-Modus: ignorieren (kein sinnvolles 1:1-Mapping)
      return
    }
    const sel = ensureEditorSelection()
    if (!sel || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)

    if (range.collapsed) {
      // Keine Auswahl: leerer Style-Span mit Zero-Width-Space, Cursor rein
      const span = document.createElement('span')
      Object.assign(span.style, styleObj)
      const zwsp = document.createTextNode('\u200B')
      span.appendChild(zwsp)
      range.insertNode(span)
      const inside = document.createRange()
      inside.setStart(zwsp, 1)
      inside.collapse(true)
      sel.removeAllRanges()
      sel.addRange(inside)
      return
    }

    // Auswahl vorhanden: pro Textknoten den ausgew\u00E4hlten Teil in einen eigenen
    // Style-Span wrappen (#41). Der fr\u00FChere Ansatz (`range.extractContents()`
    // in EINEN Span) zog bei mehrzeiligen Auswahlen ganze Block-Teilb\u00E4ume
    // heraus \u2014 Listen wurden gespalten (doppelte Nummerierung), Normaltext gar
    // nicht gef\u00E4rbt. Textknoten \u00FCberschreiten nie eine Blockgrenze, also l\u00E4sst
    // das Wrappen je Knoten Listen-/Block-Struktur unangetastet.
    const textNodes = collectSelectedTextNodes(range)
    if (textNodes.length === 0) {
      // Reine Nicht-Text-Auswahl (z. B. nur ein Bild): altes Verhalten als
      // Fallback, damit sich hier nichts regressiert.
      const span = document.createElement('span')
      Object.assign(span.style, styleObj)
      try {
        span.appendChild(range.extractContents())
      } catch {
        return
      }
      range.insertNode(span)
      const after = document.createRange()
      after.setStartAfter(span)
      after.collapse(true)
      sel.removeAllRanges()
      sel.addRange(after)
      return
    }

    let lastSpan: HTMLElement | null = null
    for (const node of textNodes) {
      const startOffset = node === range.startContainer ? range.startOffset : 0
      const endOffset = node === range.endContainer ? range.endOffset : node.length
      if (startOffset >= endOffset) continue
      // Den ausgew\u00E4hlten Bereich zu einem eigenen Textknoten aufspalten.
      let target = node
      if (endOffset < target.length) target.splitText(endOffset)
      if (startOffset > 0) target = target.splitText(startOffset)
      const span = document.createElement('span')
      Object.assign(span.style, styleObj)
      target.parentNode?.insertBefore(span, target)
      span.appendChild(target)
      lastSpan = span
    }

    // Cursor ans Ende der Auswahl (wie im Einzelspan-Verhalten der Referenz).
    // Bewusst KEINE Auswahl \u00FCber die Spans halten: das Textfarb-/Highlight-
    // <input> feuert `input` w\u00E4hrend des Ziehens laufend, ein erhaltenes
    // Selektion-Rewrap w\u00FCrde die Spans bei jedem Tick verschachteln.
    if (lastSpan) {
      const after = document.createRange()
      after.setStartAfter(lastSpan)
      after.collapse(true)
      sel.removeAllRanges()
      sel.addRange(after)
    }
  }

  // Sammelt alle Textknoten, die sich mit dem Range \u00FCberschneiden (f\u00FCr das
  // per-Knoten-Styling in #41). Reine Whitespace-Knoten (Formatierungs-
  // whitespace zwischen Bl\u00F6cken) werden \u00FCbersprungen, damit keine losen
  // Style-Spans direkt im Editor entstehen.
  function collectSelectedTextNodes(range: Range): Text[] {
    const root = range.commonAncestorContainer
    if (root.nodeType === Node.TEXT_NODE) {
      return range.startOffset < range.endOffset ? [root as Text] : []
    }
    const nodes: Text[] = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!range.intersectsNode(node)) return NodeFilter.FILTER_REJECT
        if (!node.nodeValue || node.nodeValue.trim() === '') return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_ACCEPT
      },
    })
    let n = walker.nextNode()
    while (n) {
      nodes.push(n as Text)
      n = walker.nextNode()
    }
    return nodes
  }

  function applyFontSize(px: string) {
    if (!px) return
    applyStyles({ fontSize: px + 'px' })
  }

  function applyTemplate(color: string, px: number, bold: boolean) {
    applyStyles({ color, fontSize: px + 'px', fontWeight: bold ? 'bold' : 'normal' })
  }

  // Ersetzt ein Element durch seine Kindknoten (für #42: Style-Span auflösen,
  // wenn nach dem Entfernen des Highlights kein Inline-Stil mehr übrig ist).
  function unwrapElement(el: HTMLElement) {
    const parent = el.parentNode
    if (!parent) return
    while (el.firstChild) parent.insertBefore(el.firstChild, el)
    parent.removeChild(el)
  }

  // #42: „Kein Highlight" — entfernt `background-color` aus den Style-Spans der
  // Auswahl. Der Highlight-Picker kann nur setzen; ohne diese Umkehr stapelten
  // sich verschachtelte gefärbte Spans. Ein Span, der danach keinen Inline-Stil
  // mehr trägt, wird aufgelöst, damit keine leeren Wrapper zurückbleiben.
  function clearHighlight() {
    if (isLatexActive()) return
    const sel = ensureEditorSelection()
    if (!sel || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)

    const targets = new Set<HTMLElement>()
    const addHighlightedAncestors = (start: Node | null) => {
      let node: Node | null = start
      while (node && node !== editor) {
        if (node instanceof HTMLElement && node.style.backgroundColor) targets.add(node)
        node = node.parentNode
      }
    }

    if (range.collapsed) {
      addHighlightedAncestors(range.startContainer)
    } else {
      // Nachkommen im gemeinsamen Vorfahren, die die Auswahl schneiden …
      const root = range.commonAncestorContainer
      const rootEl =
        root.nodeType === Node.ELEMENT_NODE ? (root as Element) : root.parentElement
      rootEl?.querySelectorAll<HTMLElement>('[style*="background"]').forEach((el) => {
        if (el.style.backgroundColor && range.intersectsNode(el)) targets.add(el)
      })
      // … plus gehighlightete Vorfahren der Auswahlgrenzen (Span umschließt die
      // Auswahl komplett und wird daher nicht von querySelectorAll erfasst).
      addHighlightedAncestors(range.startContainer)
      addHighlightedAncestors(range.endContainer)
    }

    for (const el of targets) {
      el.style.removeProperty('background-color')
      if (el.tagName === 'SPAN' && el.style.length === 0 && !el.className) {
        unwrapElement(el)
      }
    }
    editor.focus()
  }

  function formatBlock(tag: string) {
    if (!tag) return
    editor.focus()
    document.execCommand('formatBlock', false, tag)
  }

  function saveSelection() {
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
      state.savedRange = sel.getRangeAt(0).cloneRange()
    } else {
      state.savedRange = null
    }
  }

  function getTopLevelBlock(node: Node | null): Node | null {
    while (node && node.parentNode && node.parentNode !== editor) {
      node = node.parentNode
    }
    return node && node.parentNode === editor ? node : null
  }

  // Fügt einen Block-Knoten nach dem Top-Level-Block der aktuellen Cursor-Position ein
  function insertBlockAtCursor(blockNode: HTMLElement, trailingP?: HTMLElement) {
    editor.focus()
    let topLevel: Node | null = null
    if (state.savedRange) {
      topLevel = getTopLevelBlock(state.savedRange.startContainer)
    }
    if (topLevel && topLevel.parentNode === editor) {
      editor.insertBefore(blockNode, topLevel.nextSibling)
      if (trailingP) editor.insertBefore(trailingP, blockNode.nextSibling)
    } else {
      // Kein Top-Level-Block (Editor leer oder Cursor direkt im editor) → ans Ende
      editor.appendChild(blockNode)
      if (trailingP) editor.appendChild(trailingP)
    }
    // Cursor in den trailing-Absatz oder hinter den Block
    const sel = window.getSelection()
    if (!sel) return
    const r = document.createRange()
    if (trailingP) {
      r.setStart(trailingP, 0)
    } else {
      r.setStartAfter(blockNode)
    }
    r.collapse(true)
    sel.removeAllRanges()
    sel.addRange(r)
    state.savedRange = r.cloneRange()
  }

  // --- LaTeX-Modal (slice 3, #31) ---

  function isLatexActive(): boolean {
    return lastFocused === 'latex' && latexOverlay.classList.contains('open')
  }

  /**
   * The reference's final `resolveFieldPlaceholders`
   * (patch-output-as-input-latex-fix-v1, L2698) via the pure module:
   * `[input:x]`/`[output:x]` resolve against the live field graph
   * (output-as-input rule, `[output:x]` write-back through
   * `fieldGraph.setLatexValue`) and `*` is display-prettified. Single seam
   * for all call sites — modal live preview, insert/edit, library previews,
   * library drops and the placeholder re-render loop — so every one of them
   * carries the reference's write-back side effect (parity, ratified in #34
   * planning: previews DO persist output values on debounce ticks).
   */
  function resolveForDisplay(rawLatex: string): string {
    return resolveFieldPlaceholders(fieldGraph, rawLatex)
  }

  function openLatexModal(existingBlock?: HTMLElement | null) {
    saveSelection()
    editingFormulaBlock = existingBlock ?? null

    if (editingFormulaBlock) {
      const target = editingFormulaBlock.querySelector<HTMLElement>('.render-target')
      latexModalTitle.textContent = 'Formel bearbeiten'
      latexDeleteBtn.style.display = ''
      latexApplyBtn.textContent = 'Aktualisieren'
      latexInput.value = target?.dataset['rawLatex'] || target?.dataset['latex'] || ''
    } else {
      latexModalTitle.textContent = 'LaTeX-Formel einfügen'
      latexDeleteBtn.style.display = 'none'
      latexApplyBtn.textContent = 'Gerendert einfügen'
      latexInput.value = ''
    }

    // (populateFieldQuickInsert of the reference was already a no-op — not ported.)
    latexOverlay.classList.add('open')
    latexInput.focus()
    updateLatexPreview()
  }

  function closeLatexModal() {
    latexOverlay.classList.remove('open')
    editingFormulaBlock = null
  }

  // Wrappt die LaTeX-Textarea-Auswahl in einen Farb-Befehl. Deviation vom
  // Reference-Format `\textcolor[HTML]{HEX}` (#40): MathJax v3 kennt kein
  // HTML-Farbmodell (nur rgb/RGB/gray → "Color model 'HTML' not defined"),
  // und \colorbox akzeptiert gar kein Modell-Argument — die Referenz-Wraps
  // haben also NIE gerendert. Stattdessen CSS-Durchreichung `{#HEX}`: nicht
  // definierte Farbnamen nutzt das color-Package direkt als CSS-Wert
  // (empirisch gegen das gepinnte 3.2.2 verifiziert, inkl. \colorbox und
  // Verschachtelung; der Referenz-Kommentar „kein #, da das in math-mode
  // bricht" trifft im Farb-Argument nicht zu). Der \colorbox-INHALT ist
  // TeX-Text-Modus — das Highlight-Wrap steigt darum mit `$…$` wieder in
  // den Math-Modus ein (Auswahl in der Formel ist praktisch immer Mathe;
  // ohne $ hieße es „\frac is only supported in math mode").
  function wrapTextareaSelectionWithLatex(commandStart: string, commandEnd: string) {
    const start = latexInput.selectionStart
    const end = latexInput.selectionEnd
    if (start === end) {
      // Keine Auswahl: an Cursor einfügen, Cursor zwischen Wrapper setzen
      const insert = commandStart + commandEnd
      latexInput.value = latexInput.value.slice(0, start) + insert + latexInput.value.slice(end)
      const innerPos = start + commandStart.length
      latexInput.focus()
      latexInput.setSelectionRange(innerPos, innerPos)
    } else {
      const selected = latexInput.value.slice(start, end)
      const wrapped = commandStart + selected + commandEnd
      latexInput.value = latexInput.value.slice(0, start) + wrapped + latexInput.value.slice(end)
      const newPos = start + wrapped.length
      latexInput.focus()
      latexInput.setSelectionRange(newPos, newPos)
    }
    updateLatexPreview()
  }

  function applyLatexColor(hex: string) {
    const clean = (hex || '').replace('#', '').toUpperCase()
    wrapTextareaSelectionWithLatex('\\textcolor{#' + clean + '}{', '}')
  }

  function applyLatexHighlight(hex: string) {
    const clean = (hex || '').replace('#', '').toUpperCase()
    wrapTextareaSelectionWithLatex('\\colorbox{#' + clean + '}{$', '$}')
  }

  function updateLatexPreview() {
    clearTimeout(latexPreviewTimer)
    latexPreviewTimer = setTimeout(async () => {
      const raw = cleanupLatex(latexInput.value)
      if (!raw) {
        latexPreviewBox.innerHTML = PREVIEW_PLACEHOLDER_HTML
        return
      }
      const resolved = resolveForDisplay(raw)
      try {
        const mathJax = await loadMathJax()
        const svg = await mathJax.tex2svgPromise(resolved, { display: true })
        latexPreviewBox.innerHTML = ''
        latexPreviewBox.appendChild(svg)
      } catch (err) {
        latexPreviewBox.innerHTML =
          '<div class="formula-error">MathJax-Fehler:\n' + escapeHtml(errorMessage(err)) + '</div>'
      }
    }, 250)
  }

  function insertLatexCodeblock() {
    const latex = cleanupLatex(latexInput.value)
    closeLatexModal()
    if (!latex) return
    const pre = document.createElement('pre')
    pre.textContent = latex
    const trailing = document.createElement('p')
    trailing.innerHTML = '<br>'
    insertBlockAtCursor(pre, trailing)
  }

  async function renderLatexInElement(target: HTMLElement, latex: string) {
    target.classList.add('is-loading')
    target.textContent = 'Rendering...'

    try {
      // Deviation from the reference (which awaited MathJax OUTSIDE its
      // try/catch): a load failure lands in the German error box here
      // instead of escaping as an unhandled rejection.
      const mathJax = await loadMathJax()
      const svg = await mathJax.tex2svgPromise(latex, { display: true })
      target.classList.remove('is-loading')
      target.innerHTML = ''
      target.appendChild(svg)
      target.dataset['latex'] = latex
    } catch (err) {
      target.classList.remove('is-loading')
      target.innerHTML =
        '<div class="formula-error">MathJax-Fehler:\n' +
        escapeHtml(errorMessage(err)) +
        '\n\nLaTeX:\n' +
        escapeHtml(latex) +
        '</div>'
    }
  }

  // Formula-block markup shared by modal insertion and library drops
  // (reference L1037–1044 and its verbatim copy L1154–1161).
  function createFormulaBlockElement(raw: string, resolved: string): HTMLElement {
    const block = document.createElement('div')
    block.className = 'formula-block'
    block.draggable = true
    block.innerHTML =
      '<span class="drag-handle" contenteditable="false">&#10074;&#10074;</span>' +
      '<div class="render-target" contenteditable="false" data-raw-latex="' +
      escapeHtml(raw) +
      '" data-latex="' +
      escapeHtml(resolved) +
      '">' +
      escapeHtml(resolved) +
      '</div>'
    return block
  }

  async function insertLatexRendered() {
    // The edited block and its previous raw LaTeX must be captured BEFORE
    // closeLatexModal() nulls the editing state (patch L2647).
    const raw = cleanupLatex(latexInput.value)
    const block = editingFormulaBlock
    const oldRaw = block
      ? block.querySelector<HTMLElement>('.render-target')?.dataset['rawLatex'] ||
        block.querySelector<HTMLElement>('.render-target')?.dataset['latex'] ||
        ''
      : ''
    closeLatexModal()
    if (!raw) return

    const resolved = resolveForDisplay(raw)

    if (block) {
      // Bestehende Formel updaten
      const target = block.querySelector<HTMLElement>('.render-target')
      if (!target) return
      target.dataset['rawLatex'] = raw
      target.dataset['latex'] = resolved
      await renderLatexInElement(target, resolved)
      await syncFormulaLibraryAfterEdit(oldRaw, raw)
      return
    }

    // Neue Formel einfügen
    const blockEl = createFormulaBlockElement(raw, resolved)
    const trailing = document.createElement('p')
    trailing.innerHTML = '<br>'
    insertBlockAtCursor(blockEl, trailing)

    const target = blockEl.querySelector<HTMLElement>('.render-target')!
    await renderLatexInElement(target, resolved)

    await addToLibrary(raw)
  }

  function deleteCurrentFormula() {
    if (editingFormulaBlock) {
      editingFormulaBlock.remove()
    }
    closeLatexModal()
  }

  // --- Formel-Bibliothek (slice 4, #32) ---
  // Session-scoped by design (PRD: no persistence across sessions/drafts);
  // items are identified by their raw LaTeX in dataset.latex. resetEditor
  // deliberately leaves the library alone (reference parity).

  function libraryItems(): HTMLElement[] {
    return Array.from(libraryList.querySelectorAll<HTMLElement>('.library-item'))
  }

  // The patch's `preview()` helper (L2647): text fallback first, then the
  // mini-render — on MathJax failure the LaTeX text simply stays.
  async function updateLibraryItemPreview(item: HTMLElement, latex: string) {
    const preview = item.querySelector<HTMLElement>('.preview')
    if (!preview) return
    preview.textContent = latex
    try {
      const mathJax = await loadMathJax()
      // Aufgelöste Version zeigen, falls Platzhalter enthalten sind
      const svg = await mathJax.tex2svgPromise(resolveForDisplay(latex), { display: true })
      preview.innerHTML = ''
      preview.appendChild(svg)
    } catch {
      preview.textContent = latex
    }
  }

  async function addToLibrary(latex: string) {
    // Duplikate vermeiden (decision: library-sync.ts)
    if (!shouldAddToLibrary(libraryItems().map((it) => it.dataset['latex'] ?? ''), latex)) return

    const empty = libraryList.querySelector('.library-empty')
    if (empty) empty.remove()

    const item = document.createElement('div')
    item.className = 'library-item'
    item.draggable = true
    item.dataset['latex'] = latex
    item.title = 'Ziehen, um in den Editor einzufügen'

    const preview = document.createElement('div')
    preview.className = 'preview'
    preview.textContent = latex
    item.appendChild(preview)

    const rm = document.createElement('button')
    rm.type = 'button'
    rm.className = 'lib-remove'
    rm.textContent = '×'
    rm.title = 'Aus Bibliothek entfernen'
    rm.addEventListener('click', (e) => {
      e.stopPropagation()
      item.remove()
      if (!libraryList.querySelector('.library-item')) {
        const e2 = document.createElement('div')
        e2.className = 'library-empty'
        e2.textContent = 'Noch keine Formeln in der Bibliothek.'
        libraryList.appendChild(e2)
      }
    })
    item.appendChild(rm)

    libraryList.appendChild(item)

    // Consolidated dragstart (base L1114 closure, superseded by the L2647
    // patch's capture-phase `ensureDrag` — last definition wins): the
    // payload reads dataset.latex at drag time, so an in-place library sync
    // never leaves a stale closure behind.
    item.addEventListener('dragstart', (e) => {
      if (!e.dataTransfer) return
      const current = item.dataset['latex'] ?? ''
      e.dataTransfer.effectAllowed = 'copy'
      e.dataTransfer.setData('application/x-latex', current)
      e.dataTransfer.setData('text/plain', current)
    })

    await updateLibraryItemPreview(item, latex)
  }

  // Hält die Bibliothek nach dem Bearbeiten einer Formel synchron
  // (patch L2647; decision logic in library-sync.ts).
  async function syncFormulaLibraryAfterEdit(oldLatex: string, newLatex: string) {
    const items = libraryItems()
    const action = librarySyncAction(
      items.map((it) => it.dataset['latex'] ?? ''),
      oldLatex,
      newLatex
    )
    switch (action.kind) {
      case 'remove-old':
        // Edit-Kollision: der bestehende Eintrag für newLatex bleibt
        items[action.index]?.remove()
        return
      case 'update-old': {
        const item = items[action.index]
        if (!item) return
        item.dataset['latex'] = newLatex
        await updateLibraryItemPreview(item, newLatex)
        return
      }
      case 'add':
        await addToLibrary(newLatex)
        return
      case 'noop':
        return
    }
  }

  async function insertFormulaFromLibraryAt(rawLatex: string, clientX: number, clientY: number) {
    // Cursor an Drop-Position setzen
    const dropRange = caretRangeAtPoint(clientX, clientY)
    if (dropRange && editor.contains(dropRange.startContainer)) {
      const sel = window.getSelection()
      if (sel) {
        sel.removeAllRanges()
        sel.addRange(dropRange)
      }
      state.savedRange = dropRange.cloneRange()
    }

    const resolved = resolveForDisplay(rawLatex)
    const block = createFormulaBlockElement(rawLatex, resolved)
    const trailing = document.createElement('p')
    trailing.innerHTML = '<br>'
    insertBlockAtCursor(block, trailing)

    const target = block.querySelector<HTMLElement>('.render-target')!
    await renderLatexInElement(target, resolved)
  }

  // --- Input/Output-Felder (slice 5, #33) ---
  // Value/display decisions live in field-resolver.ts (pure, tested); this
  // section is the thin DOM adapter of the PRD plus the reference's DOM
  // manipulation. Consolidation notes in the file header.

  function nextFieldId(): string {
    return 'fld_' + Date.now().toString(36) + '_' + ++fieldCounter
  }

  function getFieldElement(id: string): HTMLElement | null {
    return editor.querySelector<HTMLElement>('[data-field-id="' + id + '"]')
  }

  function getAllFieldElements(): HTMLElement[] {
    return Array.from(editor.querySelectorAll<HTMLElement>('.input-field, .output-field'))
  }

  function getFieldElementByName(name: string): HTMLElement | null {
    if (!name) return null
    return getAllFieldElements().find((el) => el.dataset['name'] === name) ?? null
  }

  function toFieldData(el: HTMLElement): FieldData {
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

  // Tokenisiert eine Zeile (= Top-Level-Block wie <p>, <h1>) in Zeichen- und
  // Feld-Tokens in Dokumentreihenfolge (reference tokenizeLine, L1507).
  function tokenizeLine(lineNode: Node): LineToken[] {
    const tokens: LineToken[] = []
    function walk(node: Node) {
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
    walk(lineNode)
    return tokens
  }

  // The thin DOM adapter of the PRD — field-resolver sees plain objects only.
  const fieldGraph: FieldGraph = {
    byId(id) {
      const el = getFieldElement(id)
      return el ? toFieldData(el) : null
    },
    all() {
      return getAllFieldElements().map(toFieldData)
    },
    lineTokensFor(fieldId) {
      const el = getFieldElement(fieldId)
      if (!el) return null
      const line = getTopLevelBlock(el)
      if (!line) return null
      // Versteckte Felder haben keinen Text-Kontext (reference L1532)
      if (line instanceof HTMLElement && line.id === 'hiddenFields') return null
      return tokenizeLine(line)
    },
    // Write-back eines [output:x]-Berechnungsziels (reference L2710–2717).
    // Wie die Reference wird nur EIN Element beschrieben (dort das
    // by-name-Element, hier das erste mit der field-id — identisch, denn
    // Outputs haben keine gleich-id-Klone: Referenz-Pillen bekommen eigene
    // ids). Der Pill-Text wird sofort mitgezogen; die Sidebar folgt beim
    // nächsten renderVariableList (1s-Sweep) — Reference-Timing.
    setLatexValue(fieldId, v) {
      const el = getFieldElement(fieldId)
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

  function makeFieldSpan(type: 'input' | 'output'): HTMLElement {
    const span = document.createElement('span')
    span.className = type === 'input' ? 'input-field' : 'output-field'
    span.contentEditable = 'false'
    span.dataset['fieldId'] = nextFieldId()
    span.dataset['type'] = type
    if (type === 'input') {
      span.dataset['refType'] = 'static'
      span.dataset['value'] = '0'
      span.textContent = '0'
    } else {
      span.dataset['expr'] = ''
      span.textContent = '?'
    }
    // Click-to-edit is delegated via onEditorClick (see deviation note there).
    return span
  }

  function insertNodeAtCursor(node: Node) {
    editor.focus()
    let sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || !editor.contains(sel.anchorNode)) {
      if (sel && state.savedRange) {
        sel.removeAllRanges()
        sel.addRange(state.savedRange)
      } else {
        ensureEditorSelection()
      }
    }
    sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    range.deleteContents()
    range.insertNode(node)
    const after = document.createRange()
    after.setStartAfter(node)
    after.collapse(true)
    sel.removeAllRanges()
    sel.addRange(after)
    state.savedRange = after.cloneRange()
  }

  // Felder, die nur in LaTeX-Formeln referenziert werden, leben im Editor
  // (für getAllFieldElements / Sidebar / Platzhalter-Lookup), werden aber
  // visuell nicht inline angezeigt — sondern in einem versteckten Container.
  function putFieldIntoHiddenStore(span: HTMLElement) {
    let store = editor.querySelector<HTMLElement>('#hiddenFields')
    if (!store) {
      store = document.createElement('div')
      store.id = 'hiddenFields'
      store.style.display = 'none'
      store.contentEditable = 'false'
      editor.appendChild(store)
    }
    store.appendChild(span)
  }

  // insertInputField/insertOutputField of the reference (L1757–1787),
  // consolidated into one helper — the originals differ only in the type.
  function insertField(type: 'input' | 'output') {
    isFieldBeingCreated = true
    if (isLatexActive()) {
      // LaTeX-Modus: Feld in den Hidden-Store; der Platzhalter wird nach dem
      // Modal-Save an der gemerkten Textarea-Position eingefügt und löst in
      // der Formel live auf (resolveForDisplay).
      savedLatexTextareaPos = { start: latexInput.selectionStart, end: latexInput.selectionEnd }
      pendingLatexFieldInsert = true
      const span = makeFieldSpan(type)
      putFieldIntoHiddenStore(span)
      openFieldModal(span.dataset['fieldId'] ?? '')
      return
    }
    const span = makeFieldSpan(type)
    insertNodeAtCursor(span)
    openFieldModal(span.dataset['fieldId'] ?? '')
  }

  function insertAtTextareaCursor(text: string) {
    const start = latexInput.selectionStart
    const end = latexInput.selectionEnd
    latexInput.value = latexInput.value.slice(0, start) + text + latexInput.value.slice(end)
    const newPos = start + text.length
    latexInput.focus()
    latexInput.setSelectionRange(newPos, newPos)
    lastFocused = 'latex'
    updateLatexPreview()
  }

  // --- Feld-Modal (base script L1806–1955) ---

  function openFieldModal(id: string) {
    const el = getFieldElement(id)
    if (!el) return
    editingFieldId = id
    const t = el.dataset['type']
    fieldModalTitle.textContent = t === 'input' ? 'Input-Feld bearbeiten' : 'Output-Feld bearbeiten'
    fieldNameInput.value = el.dataset['name'] || ''
    nameRequiredHint.textContent = t === 'output' ? '(Pflicht)' : '(optional)'
    fieldInputOptions.style.display = t === 'input' ? '' : 'none'
    fieldOutputOptions.style.display = t === 'output' ? '' : 'none'

    if (t === 'input') {
      fieldRefTypeSelect.value = el.dataset['refType'] || 'static'
      fieldValueInput.value = el.dataset['value'] || ''
      // Output-Optionen für Referenz befüllen
      fieldRefTarget.innerHTML = ''
      getAllFieldElements()
        .filter((f) => f.dataset['type'] === 'output' && f.dataset['fieldId'] !== id)
        .forEach((f) => {
          const opt = document.createElement('option')
          opt.value = f.dataset['fieldId'] ?? ''
          opt.textContent = f.dataset['name'] || '(unbenannt)'
          if (f.dataset['fieldId'] === el.dataset['refId']) opt.selected = true
          fieldRefTarget.appendChild(opt)
        })
      if (!fieldRefTarget.options.length) {
        const opt = document.createElement('option')
        opt.value = ''
        opt.textContent = '(keine Output-Felder vorhanden)'
        fieldRefTarget.appendChild(opt)
      }
      onFieldRefTypeChange()
    } else {
      fieldExprInput.value = el.dataset['expr'] || ''
      const avail = getAllFieldElements()
        .filter((f) => f.dataset['name'] && f.dataset['fieldId'] !== id)
        .map((f) => f.dataset['name'] ?? '')
      fieldAvailVars.textContent = avail.length ? avail.join(', ') : '—'

      // Bei "frei schwebenden" Outputs (LaTeX-Modus): Auto-Erkennung liest
      // aus dem LaTeX-Code selbst statt aus dem Haupteditor-Text.
      const isInHiddenStore = Boolean(el.closest('#hiddenFields'))
      outputAutoHint.innerHTML = isInHiddenStore
        ? 'Die Formel wird automatisch aus dem <b>LaTeX-Code</b> abgeleitet: zwischen <code>:</code> und <code>=</code>, zwischen zwei <code>=</code>, oder zwischen Textanfang und <code>=</code> (relativ zur Stelle des Platzhalters im Code).<br>Beispiel: <code>A = 2^2 = [output:AA]</code> → rechnet <code>2^2</code>.'
        : 'Die Formel wird automatisch aus dem Text davor erkannt: zwischen <code>:</code> und <code>=</code>, zwischen zwei <code>=</code>, oder zwischen Zeilenanfang und <code>=</code>.<br>Beispiel: „Berechnung: 2+4*3 = <b>[Output]</b>“ → rechnet <code>2+4*3</code>.'
      // (The reference also re-assigned the constant fieldExprLabel text and
      // fieldExpr placeholder here — no-ops against this markup, not ported.)
    }

    fieldOverlay.classList.add('open')
    fieldNameInput.focus()
  }

  function onFieldRefTypeChange() {
    const t = fieldRefTypeSelect.value
    fieldValueLabel.style.display = t === 'static' ? '' : 'none'
    fieldRefLabel.style.display = t === 'ref' ? '' : 'none'
  }

  function saveFieldFromModal() {
    if (!editingFieldId) return
    const name = fieldNameInput.value.trim()

    // Unique-name patch (L2653), inlined BEFORE the base save preserving its
    // call order — the duplicate check runs even before the required-name
    // check below (decision logic in field-resolver.findDuplicateName).
    const duplicate = findDuplicateName(fieldGraph, name, editingFieldId)
    if (duplicate) {
      window.alert(
        'Variablenname bereits vergeben: "' + name + '".\nBitte einen eindeutigen Namen verwenden.'
      )
      fieldNameInput.focus()
      fieldNameInput.select()
      return
    }

    // Base save (L1867).
    const el = getFieldElement(editingFieldId)
    if (!el) {
      closeFieldModal()
      return
    }
    if (el.dataset['type'] === 'output' && !name) {
      window.alert('Bitte einen Namen für das Output-Feld eingeben.')
      fieldNameInput.focus()
      return
    }

    el.dataset['name'] = name
    if (el.dataset['type'] === 'input') {
      const rt = fieldRefTypeSelect.value
      el.dataset['refType'] = rt
      if (rt === 'static') {
        el.dataset['value'] = fieldValueInput.value.trim() || '0'
        delete el.dataset['refId']
      } else {
        el.dataset['refId'] = fieldRefTarget.value
      }
    } else {
      el.dataset['expr'] = fieldExprInput.value.trim()
    }

    // Daten auf alle Klone mit gleicher field-id übertragen
    syncFieldClones(el)
    updateAllFields()

    // LaTeX-Modus: Platzhalter an gespeicherte Textarea-Position einfügen
    if (pendingLatexFieldInsert && name) {
      if (savedLatexTextareaPos) {
        latexInput.setSelectionRange(savedLatexTextareaPos.start, savedLatexTextareaPos.end)
      }
      insertAtTextareaCursor('[' + el.dataset['type'] + ':' + name + ']')
    }
    pendingLatexFieldInsert = false
    savedLatexTextareaPos = null
    isFieldBeingCreated = false

    closeFieldModal()
  }

  // Überträgt Konfigurations-Daten vom Master-Element auf alle DOM-Klone mit
  // gleicher field-id (reference L1914).
  function syncFieldClones(master: HTMLElement) {
    const id = master.dataset['fieldId']
    if (!id) return
    editor.querySelectorAll<HTMLElement>('[data-field-id="' + id + '"]').forEach((other) => {
      if (other === master) return
      other.dataset['name'] = master.dataset['name'] || ''
      other.dataset['type'] = master.dataset['type'] ?? ''
      if (master.dataset['type'] === 'input') {
        other.dataset['refType'] = master.dataset['refType'] || 'static'
        if (master.dataset['value'] !== undefined) other.dataset['value'] = master.dataset['value']
        if (master.dataset['refId'] !== undefined) other.dataset['refId'] = master.dataset['refId']
        else delete other.dataset['refId']
      } else {
        other.dataset['expr'] = master.dataset['expr'] || ''
      }
    })
  }

  function closeFieldModal() {
    // Frisch angelegtes, unbestätigtes Feld beim Abbrechen entfernen (alle Klone)
    if (isFieldBeingCreated && editingFieldId) {
      editor
        .querySelectorAll<HTMLElement>('[data-field-id="' + editingFieldId + '"]')
        .forEach((el) => el.remove())
      updateAllFields()
    }
    isFieldBeingCreated = false
    fieldOverlay.classList.remove('open')
    editingFieldId = null
    pendingLatexFieldInsert = false
    savedLatexTextareaPos = null
  }

  function deleteCurrentField() {
    if (!editingFieldId) return
    editor
      .querySelectorAll<HTMLElement>('[data-field-id="' + editingFieldId + '"]')
      .forEach((el) => el.remove())
    isFieldBeingCreated = false
    updateAllFields()
    closeFieldModal()
  }

  // --- Feld-Werte & Sidebar ---

  // Consolidated updateAllFields: the base loop (L1624) with the FINAL PATCH
  // fixups (L2288) folded into field-resolver.fieldDisplay — one pass
  // reproduces the composed behavior, and renderVariableList runs once
  // instead of twice.
  function updateAllFields() {
    getAllFieldElements().forEach((el) => {
      const id = el.dataset['fieldId']
      if (!id) return
      const display = fieldDisplay(fieldGraph, id)
      el.textContent = display.text
      el.classList.toggle('is-ref', display.isRef)
      el.classList.toggle('is-error', display.isError)
    })
    renderVariableList()
    void reRenderFormulasWithPlaceholders()
  }

  // Re-render von Formeln mit [input:x]/[output:x]-Platzhaltern (reference
  // L1651): nur Formeln, deren aufgelöster LaTeX sich geändert hat, werden
  // neu gerendert — abhängige Formeln folgen Wertänderungen, unabhängige
  // bleiben unangetastet. Write-backs passieren in Dokumentreihenfolge, so
  // dass Formel n+1 die frischen [output:x]-Werte von Formel n sieht.
  async function reRenderFormulasWithPlaceholders() {
    const targets = editor.querySelectorAll<HTMLElement>('.render-target[data-raw-latex]')
    for (const target of Array.from(targets)) {
      const raw = target.dataset['rawLatex']
      if (!raw || !/\[(input|output):/.test(raw)) continue
      const resolved = resolveForDisplay(raw)
      if (resolved === target.dataset['latex']) continue // unverändert, kein Re-Render nötig
      target.dataset['latex'] = resolved
      await renderLatexInElement(target, resolved)
    }
  }

  // Variablen-Sidebar (FINAL PATCH L2216, supersedes base L1663): eine Zeile
  // pro field-id, drag-erzeugte Output-Referenzen (referenceClone) bleiben
  // ausgeblendet, Drag-Payload mit Fallback über text/plain.
  function renderVariableList() {
    const seen = new Set<string>()
    const fields = getAllFieldElements().filter((el) => {
      if (el.dataset['referenceClone'] === 'true') return false
      const id = el.dataset['fieldId'] ?? ''
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
    variableList.innerHTML = ''
    if (!fields.length) {
      const empty = document.createElement('div')
      empty.className = 'library-empty'
      empty.textContent = 'Noch keine Felder. Füge Input/Output über die Toolbar hinzu.'
      variableList.appendChild(empty)
      return
    }
    fields.forEach((el) => {
      const t = el.dataset['type']
      const item = document.createElement('div')
      item.className = 'var-item ' + (t === 'input' ? 'var-input' : 'var-output')
      if (!el.dataset['name']) item.classList.add('var-noname')

      const nameSpan = document.createElement('span')
      nameSpan.className = 'var-name'
      nameSpan.textContent = el.dataset['name'] || '(unbenannt)'
      nameSpan.title =
        (t === 'input' ? 'Input: ' : 'Output: ') + (el.dataset['name'] || '(unbenannt)')

      const valSpan = document.createElement('span')
      valSpan.className = 'var-value'
      valSpan.textContent = el.textContent

      item.appendChild(nameSpan)
      item.appendChild(valSpan)
      item.style.cursor = 'grab'
      item.draggable = true
      item.title = 'Ziehen, um diese Variable in den Text einzufügen'
      item.addEventListener('click', () => openFieldModal(el.dataset['fieldId'] ?? ''))
      item.addEventListener('dragstart', (ev) => {
        if (!ev.dataTransfer) return
        ev.dataTransfer.effectAllowed = 'copy'
        ev.dataTransfer.setData('application/x-field-id', el.dataset['fieldId'] ?? '')
        ev.dataTransfer.setData('application/x-field-kind', el.dataset['type'] || '')
        ev.dataTransfer.setData('text/plain', '__FIELD_ID__:' + (el.dataset['fieldId'] ?? ''))
      })
      variableList.appendChild(item)
    })
  }

  // --- Variable in den Text ziehen / getippte Platzhalter (FINAL PATCH L2166–2297) ---

  // Sichtbarer Klon eines Inputs — teilt die field-id mit dem Master (L2166).
  function makeVisibleInputClone(inputEl: HTMLElement): HTMLElement {
    const n = document.createElement('span')
    n.className = 'input-field' + (inputEl.dataset['refType'] === 'ref' ? ' is-ref' : '')
    n.contentEditable = 'false'
    n.dataset['fieldId'] = inputEl.dataset['fieldId'] ?? ''
    n.dataset['type'] = 'input'
    n.dataset['name'] = inputEl.dataset['name'] || ''
    n.dataset['refType'] = inputEl.dataset['refType'] || 'static'
    if (inputEl.dataset['value'] !== undefined) n.dataset['value'] = inputEl.dataset['value']
    if (inputEl.dataset['refId'] !== undefined) n.dataset['refId'] = inputEl.dataset['refId']
    n.textContent = inputEl.textContent || inputEl.dataset['value'] || '0'
    return n
  }

  // Neue Input-Referenz auf ein Output-Feld — eigene field-id; per
  // referenceClone-Flag aus der Variablen-Sidebar ausgeblendet (L2182).
  function makeInputReferenceToOutput(outputEl: HTMLElement): HTMLElement {
    const ref = document.createElement('span')
    ref.className = 'input-field is-ref'
    ref.contentEditable = 'false'
    ref.dataset['fieldId'] = nextFieldId()
    ref.dataset['type'] = 'input'
    ref.dataset['refType'] = 'ref'
    ref.dataset['refId'] = outputEl.dataset['fieldId'] ?? ''
    ref.dataset['referenceClone'] = 'true'
    ref.dataset['sourceOutputName'] = outputEl.dataset['name'] || ''
    ref.dataset['name'] = ''
    const v = getFieldValue(fieldGraph, outputEl.dataset['fieldId'] ?? '', new Set())
    ref.textContent = Number.isFinite(v) ? formatValue(v) : outputEl.textContent || '—'
    return ref
  }

  // Feld-Knoten an der Drop-Position einfügen; ohne gültige Position (oder im
  // Hidden-Store) ans Editor-Ende in einem neuen Absatz (insertAtDrop, L2199).
  function insertFieldNodeAtDrop(node: HTMLElement, clientX: number, clientY: number) {
    const dropRange = caretRangeAtPoint(clientX, clientY)
    const hidden = editor.querySelector('#hiddenFields')
    if (
      !dropRange ||
      !editor.contains(dropRange.startContainer) ||
      (hidden && hidden.contains(dropRange.startContainer))
    ) {
      const p = document.createElement('p')
      p.appendChild(node)
      p.appendChild(document.createTextNode('\u00A0'))
      editor.appendChild(p)
      const sel = window.getSelection()
      if (!sel) return
      const r = document.createRange()
      r.setStart(p, p.childNodes.length)
      r.collapse(true)
      sel.removeAllRanges()
      sel.addRange(r)
      state.savedRange = r.cloneRange()
      return
    }
    dropRange.deleteContents()
    dropRange.insertNode(node)
    const space = document.createTextNode('\u00A0')
    node.parentNode?.insertBefore(space, node.nextSibling)
    const sel = window.getSelection()
    if (!sel) return
    const after = document.createRange()
    after.setStartAfter(space)
    after.collapse(true)
    sel.removeAllRanges()
    sel.addRange(after)
    state.savedRange = after.cloneRange()
  }

  // Drop einer Variable aus der Sidebar (L2209 — supersedes the base version
  // L2096 entirely, including its hidden-store move logic): Output → neue
  // Referenz-Pille, Input → sichtbarer Klon mit gleicher field-id.
  function cloneFieldToDropPosition(fieldId: string, clientX: number, clientY: number) {
    const master = getFieldElement(fieldId)
    if (!master) return
    const node =
      master.dataset['type'] === 'output'
        ? makeInputReferenceToOutput(master)
        : makeVisibleInputClone(master)
    insertFieldNodeAtDrop(node, clientX, clientY)
    updateAllFields()
  }

  // Getippte [input:x]/[output:x]-Platzhalter im Fließtext in Pillen
  // umwandeln (L2280). Die Umwandlungsregel (getipptes Kind muss zum Feldtyp
  // passen) liegt in field-resolver.classifyTypedPlaceholder.
  function convertTypedFieldPlaceholders() {
    const hidden = editor.querySelector('#hiddenFields')
    const re = /\[(input|output):([^\]]+)\]/g
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !/\[(input|output):([^\]]+)\]/.test(node.nodeValue)) {
          return NodeFilter.FILTER_REJECT
        }
        const parent = node.parentElement
        if (!parent) return NodeFilter.FILTER_REJECT
        if (hidden && hidden.contains(node)) return NodeFilter.FILTER_REJECT
        if (
          parent.closest(
            '.input-field, .output-field, .render-target, .formula-block, .image-block, pre'
          )
        ) {
          return NodeFilter.FILTER_REJECT
        }
        return NodeFilter.FILTER_ACCEPT
      },
    })
    const nodes: Text[] = []
    while (walker.nextNode()) nodes.push(walker.currentNode as Text)
    nodes.forEach((node) => {
      const val = node.nodeValue ?? ''
      let last = 0
      const frag = document.createDocumentFragment()
      let m: RegExpExecArray | null
      re.lastIndex = 0
      while ((m = re.exec(val)) !== null) {
        if (m.index > last) frag.appendChild(document.createTextNode(val.slice(last, m.index)))
        const kind = m[1] as 'input' | 'output'
        const fieldEl = getFieldElementByName((m[2] || '').trim())
        const action = classifyTypedPlaceholder(kind, fieldEl ? toFieldData(fieldEl) : null)
        let replacement: HTMLElement | null = null
        if (fieldEl && action === 'output-reference') {
          replacement = makeInputReferenceToOutput(fieldEl)
        }
        if (fieldEl && action === 'visible-input-clone') {
          replacement = makeVisibleInputClone(fieldEl)
        }
        frag.appendChild(replacement ?? document.createTextNode(m[0]))
        last = re.lastIndex
      }
      if (last < val.length) frag.appendChild(document.createTextNode(val.slice(last)))
      node.parentNode?.replaceChild(frag, node)
    })
  }

  // Capture-phase field drops on editor, editorScroll and exportArea
  // (FINAL PATCH L2233–2235). stopImmediatePropagation() makes the OUTERMOST
  // capture listener (exportArea) the only one that ever acts and keeps the
  // event away from the bubble-phase onDragOver/onDrop — reference parity:
  // variable drags show NO inline drop caret, and drops insert exactly once.
  function hasDataTransferType(dt: DataTransfer, type: string): boolean {
    return Array.from(dt.types).includes(type)
  }

  const onFieldDragOverCapture = (e: DragEvent) => {
    if (e.dataTransfer && hasDataTransferType(e.dataTransfer, 'application/x-field-id')) {
      e.preventDefault()
      e.stopImmediatePropagation()
      e.dataTransfer.dropEffect = 'copy'
    }
  }

  const onFieldDropCapture = (e: DragEvent) => {
    if (!e.dataTransfer) return
    let fieldId = e.dataTransfer.getData('application/x-field-id') || ''
    if (!fieldId) {
      const plain = e.dataTransfer.getData('text/plain') || ''
      if (plain.startsWith('__FIELD_ID__:')) fieldId = plain.slice('__FIELD_ID__:'.length)
    }
    if (!fieldId) return
    e.preventDefault()
    e.stopImmediatePropagation()
    cloneFieldToDropPosition(fieldId, e.clientX, e.clientY)
  }

  // Bei Tippen im Editor: Auto-Outputs (ohne manuelle Expression) neu
  // berechnen (reference L1958) — Pillen aktualisieren live beim Tippen.
  const onEditorInput = (e: Event) => {
    // Sprungmarken (#71): every editing path that can clone a marked block —
    // paste above all, but also a contenteditable Enter that splits one —
    // funnels through `input`. The sweep is a no-op walk over the anchored
    // blocks (usually none), so it can afford to run on every keystroke.
    //
    // Enter is the one duplication the author did not ask for: the browser
    // clones the block's attributes into the new half, and re-stamping would
    // mint a second Sprungmarke under the same name. Strip it instead.
    const splitBlock = e instanceof InputEvent && e.inputType === 'insertParagraph'
    anchorRegistry.sweep(splitBlock ? 'unmark' : 'restamp')
    let needUpdate = false
    editor.querySelectorAll<HTMLElement>('.output-field').forEach((el) => {
      if (!el.dataset['expr'] || !el.dataset['expr'].trim()) needUpdate = true
    })
    if (needUpdate) updateAllFields()
  }

  function resetEditor() {
    if (window.confirm('Editor wirklich zurücksetzen? Alle Inhalte gehen verloren.')) {
      editor.innerHTML = ''
      selectBlock(null)
      anchorRegistry.forget()
    }
  }

  // --- Sprungmarken (#71) ---

  /**
   * Where a Sprungmarke would go, or why it cannot go anywhere.
   *
   * The two refusals read completely differently to an author, so they do not
   * share a message (#93): `'no-target'` means nothing is pointed at, while
   * `'unmarkable'` means the thing pointed at is real but will not survive a
   * save — a distinction the author cannot make from the editor alone.
   */
  type AnchorTarget =
    | { ok: true; block: HTMLElement }
    | { ok: false; reason: 'no-target' | 'unmarkable' }

  /**
   * The block a Sprungmarke would be placed on: the block selected by its ❚❚
   * handle if there is one, otherwise the top-level element holding the cursor
   * — provided it is one the serializer actually emits.
   *
   * The live selection is consulted first, then `state.savedRange` — a toolbar
   * button takes focus before its click handler runs, which in some browsers
   * collapses the editor's selection, and the selectionchange-maintained range
   * is what survives that (the same reason `insertBlockAtCursor` reads it).
   */
  function anchorTargetBlock(): AnchorTarget {
    // A handle-selected block wins over the caret (#92): the caret is parked in
    // some neighbouring paragraph by definition — a formula or image block
    // cannot hold one — so acting on it would mark the wrong block. An
    // unmarkable selection (an image whose upload is still in flight) refuses
    // rather than falling through, for the same reason.
    if (selectedBlock && editor.contains(selectedBlock)) {
      return serializesAsOwnBlock(selectedBlock)
        ? { ok: true, block: selectedBlock }
        : { ok: false, reason: 'unmarkable' }
    }

    const sel = window.getSelection()
    const liveRange =
      sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode) ? sel.getRangeAt(0) : null
    const caret = liveRange ?? state.savedRange
    const topLevel = getTopLevelBlock(caret?.startContainer ?? null)
    if (!topLevel) return { ok: false, reason: 'no-target' }

    // Only a block that survives serialization may carry a mark — otherwise
    // the author would place a Sprungmarke the next save silently discards.
    if (topLevel.nodeType === Node.ELEMENT_NODE && serializesAsOwnBlock(topLevel as HTMLElement)) {
      return { ok: true, block: topLevel as HTMLElement }
    }

    // The first line typed into an empty document stays a bare text node, and
    // the author sees the caret sitting in it — so refusing reads as a bug
    // (#93). Promote the stray run into the paragraph the serializer would
    // have folded it into anyway; the saved document is unchanged and the line
    // becomes markable.
    const caretNode = caret?.startContainer ?? null
    const caretOffset = caret?.startOffset ?? 0
    const promoted = promoteStrayRunToBlock(editor, topLevel)
    if (!promoted) return { ok: false, reason: 'unmarkable' }
    // Moving the run detached the caret (the DOM re-points a Range whose
    // boundary sits inside a removed node at that node's old parent), so put it
    // back where the author left it — restoreEditorSelection() replays this.
    if (caretNode && promoted.contains(caretNode)) {
      const restored = document.createRange()
      restored.setStart(caretNode, caretOffset)
      restored.collapse(true)
      state.savedRange = restored
    }
    return { ok: true, block: promoted }
  }

  function markAnchor() {
    const target = anchorTargetBlock()
    if (!target.ok) {
      window.alert(
        target.reason === 'unmarkable'
          ? 'Dieser Block kann keine Sprungmarke tragen — er wird beim Speichern nicht als eigener Block abgelegt (etwa ein Bild, dessen Upload noch läuft). Bitte einen anderen Block wählen.'
          : 'Bitte zuerst den Cursor in den Block setzen, der die Sprungmarke erhalten soll. Formel- und Bildblöcke wählst du mit einem Klick auf ihren Ziehgriff ❚❚ aus.'
      )
      return
    }
    const block = target.block
    const current = readBlockAnchor(block)
    const entered = window.prompt(
      current
        ? 'Sprungmarke umbenennen (leeres Feld entfernt die Marke):'
        : 'Name der Sprungmarke:',
      current?.label ?? ''
    )
    if (entered === null) {
      // Abbrechen — keine Marke setzen. Der Cursor muss trotzdem zurück: der
      // Zielaufruf oben kann die erste Zeile zu einem <p> befördert haben
      // (#93), und das Verschieben löst die lebende Selektion aus dem Knoten.
      restoreEditorSelection()
      return
    }
    const label = entered.trim()
    if (!label) {
      if (current) clearBlockAnchor(block)
    } else {
      // A rename KEEPS the id: every link already pointing at this Sprungmarke
      // stores that id, and re-minting it would orphan all of them.
      writeBlockAnchor(block, { id: current?.id ?? nextAnchorId(), label })
      // Adopts the id as this block's, so a later copy of it is the one that
      // gets re-stamped.
      anchorRegistry.sweep()
    }
    restoreEditorSelection()
  }

  // --- Links (#72) ---

  /**
   * The range the „Link"-button acts on: the live editor selection if there is
   * one, otherwise the selectionchange-maintained `savedRange`.
   *
   * Same reason as `anchorTargetBlock`: a toolbar button takes focus before
   * its handler runs, which in some browsers collapses or drops the editor's
   * selection, and `savedRange` is what survives that. It is also what carries
   * the author's SELECTED TEXT into the picker — the default link label.
   */
  function linkRange(): Range | null {
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode) && !sel.isCollapsed) {
      return sel.getRangeAt(0)
    }
    return state.savedRange
  }

  /** The link chip the caret sits in, or `null`. */
  function linkChipAtSelection(): HTMLElement | null {
    const range = linkRange()
    const node = range?.startContainer ?? null
    const el =
      node === null
        ? null
        : node.nodeType === Node.ELEMENT_NODE
          ? (node as Element)
          : node.parentElement
    const chip = el?.closest<HTMLElement>(LINK_CHIP_SELECTOR) ?? null
    return chip && editor.contains(chip) ? chip : null
  }

  /** Collapses the caret directly after `node` and records it as the saved range. */
  function caretAfter(node: Node) {
    const range = document.createRange()
    range.setStartAfter(node)
    range.collapse(true)
    state.savedRange = range
    editor.focus()
    const sel = window.getSelection()
    if (!sel) return
    sel.removeAllRanges()
    sel.addRange(range)
  }

  /**
   * Opens the picker for `chip` (re-target/relabel/remove) or, with no chip,
   * for a new link at the current selection.
   *
   * Unlinking replaces the chip with its own label as plain text: the author
   * asked for the link to go, not for the words to go with it.
   */
  async function runLinkPicker(chip: HTMLElement | null): Promise<void> {
    const current = chip ? readLinkChip(chip) : null
    // The selected text is only a label suggestion for a NEW link — when a chip
    // is being edited, its own label is what the picker starts from.
    const range = linkRange()
    const selectedText = current || !range || range.collapsed ? '' : range.toString()

    const result = await hooks.pickLinkTarget({ selectedText, current })
    if (!result) {
      // Cancelled — the document is untouched, but the caret still has to come
      // back from the modal.
      restoreEditorSelection()
      return
    }
    // The chip may have been removed while the modal was open (contenteditable
    // undo, a stray keystroke); acting on a detached node would silently write
    // into nothing.
    const live = chip && editor.contains(chip) ? chip : null
    if (result.action === 'remove') {
      if (live) {
        const text = document.createTextNode(live.textContent ?? '')
        live.replaceWith(text)
        caretAfter(text)
      }
      return
    }
    if (live) {
      writeLinkChip(live, result.link)
      caretAfter(live)
      return
    }
    // A fresh link REPLACES the selection it was made from — insertNodeAtCursor
    // deletes the range's contents first, so the selected text becomes the
    // chip's label rather than being duplicated beside it.
    restoreEditorSelection()
    insertNodeAtCursor(createLinkChip(document, result.link))
  }

  function insertLink() {
    void runLinkPicker(linkChipAtSelection())
  }

  /** Puts the caret back where it was before a modal/prompt stole the focus. */
  function restoreEditorSelection() {
    editor.focus()
    const sel = window.getSelection()
    if (!sel || !state.savedRange) return
    sel.removeAllRanges()
    sel.addRange(state.savedRange)
  }

  // --- Draft persistence (slice 7, #35) + JSON import (slice 9, #37) ---

  function exportDocument(): LatestEditorDocumentJson {
    return serializeEditorState(
      editor,
      libraryItems().map((it) => it.dataset['latex'] ?? '')
    )
  }

  // Port of reRenderAllLatexFormulasOutputInputAware (reference L2731–2743,
  // deferred from slice 6), consolidated with the reference's per-block
  // setTimeout renders (L2550): EVERY formula in the editor renders once —
  // in merge mode that includes pre-existing formulas, exactly what the
  // reference wrapper did — and the [output:x] write-backs run in document
  // order so formula n+1 sees formula n's fresh values. The reference's
  // trailing updateAllFields() + renderVariableList() collapse into
  // updateAllFields(), which calls renderVariableList itself.
  async function reRenderAllLatexFormulas(): Promise<void> {
    const targets = editor.querySelectorAll<HTMLElement>('.render-target[data-raw-latex]')
    for (const target of Array.from(targets)) {
      const raw = target.dataset['rawLatex'] ?? ''
      if (!raw) continue
      const resolved = resolveForDisplay(raw)
      target.dataset['latex'] = resolved
      await renderLatexInElement(target, resolved)
    }
    updateAllFields()
  }

  // Shared import path (ported importEditorJson L2569 + its wrapper patch
  // L2745–2752): draft load (replace) and the JSON modal (replace or merge).
  // The importer validates variable names BEFORE any DOM mutation, so a
  // throw here leaves the editor untouched.
  async function importDocument(
    doc: LatestEditorDocumentJson,
    options: { replaceExisting: boolean }
  ): Promise<void> {
    // A replace throws the old document away, and with it any claim its blocks
    // had on an anchor id — the incoming ids must be adopted as they are, and
    // the block the author had selected (#92) is about to stop existing.
    if (options.replaceExisting) {
      selectBlock(null)
      anchorRegistry.forget()
    }

    const result = importEditorJson(
      doc,
      editor,
      { nextFieldId, resolvePlaceholders: resolveForDisplay, imageUrl: editorImageUrl },
      options
    )

    // Merge mode can drop a second copy of an already-marked block into the
    // document, and a stored snapshot could carry a collision from before this
    // guard existed. Either way the document leaves the import unambiguous.
    anchorRegistry.sweep()

    // Library restore — replace clears first (reference L2578–2582, empty
    // text ← L2581); merge keeps existing entries. The document's own list
    // is authoritative when present (slice-7 extension); addToLibrary dedups.
    if (options.replaceExisting) {
      libraryList.innerHTML =
        '<div class="library-empty">Noch keine Formeln in der Bibliothek.</div>'
    }
    for (const latex of result.libraryLatex) {
      await addToLibrary(latex)
    }

    await reRenderAllLatexFormulas()
  }

  async function loadDocument(doc: LatestEditorDocumentJson): Promise<void> {
    return importDocument(doc, { replaceExisting: true })
  }

  // --- JSON-Import-Modal (slice 9, #37; reference L2306–2623) ---

  function openJsonImportModal() {
    jsonOverlay.classList.add('open')
    // Fokus nach dem Öffnen (reference L2356). Der Textarea-Inhalt bleibt
    // über Öffnen/Schließen erhalten (reference parity).
    setTimeout(() => jsonInput.focus(), 0)
  }

  function closeJsonImportModal() {
    jsonOverlay.classList.remove('open')
  }

  function fillJsonExample() {
    jsonInput.value = JSON.stringify(JSON_IMPORT_EXAMPLE, null, 2)
  }

  // Reference importJsonFromModal (L2610–2622). Boundary validation
  // (operator story 34): pasted JSON goes through the STRICT versioned
  // schema — the importer itself only ever sees valid documents. Every
  // failure path alerts in German and leaves the editor untouched; the
  // modal stays open so the admin can fix the JSON.
  async function importJsonFromModal(): Promise<void> {
    const raw = jsonInput.value.trim()
    if (!raw) {
      window.alert('Bitte JSON einfügen.')
      return
    }
    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(raw)
    } catch (err) {
      window.alert('JSON Import fehlgeschlagen:\nUngültiges JSON: ' + errorMessage(err))
      return
    }
    // Upgrade-on-read (#64): pasted JSON may carry any supported version, and
    // the importer only ever sees the newest one. An unreadable snapshot is
    // refused whole — never partially imported.
    const parsed = readDocumentJson(parsedJson)
    if (!parsed.ok) {
      window.alert('JSON Import fehlgeschlagen:\n' + parsed.error)
      return
    }
    try {
      await importDocument(parsed.doc, { replaceExisting: jsonReplaceExisting.checked })
    } catch (err) {
      // Duplicate/colliding variable names — thrown before any DOM mutation
      // (German messages from the importer).
      window.alert('JSON Import fehlgeschlagen:\n' + errorMessage(err))
      return
    }
    closeJsonImportModal()
  }

  // --- Tab zum Einrücken ---
  function insertTabAtCursor() {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    range.deleteContents()
    const tabNode = document.createTextNode('\u00A0\u00A0\u00A0\u00A0')
    range.insertNode(tabNode)
    range.setStartAfter(tabNode)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
  }

  function removeIndentAtCursor() {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    if (!range.collapsed) return
    const node = range.startContainer
    if (node.nodeType !== Node.TEXT_NODE) return
    const offset = range.startOffset
    const text = node.textContent ?? ''
    let removeCount = 0
    for (let i = offset - 1; i >= 0 && removeCount < 4; i--) {
      if (text[i] === '\u00A0') removeCount++
      else break
    }
    if (removeCount > 0) {
      node.textContent = text.slice(0, offset - removeCount) + text.slice(offset)
      const newRange = document.createRange()
      newRange.setStart(node, offset - removeCount)
      newRange.collapse(true)
      sel.removeAllRanges()
      sel.addRange(newRange)
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    // #92: Escape gibt eine per Ziehgriff ausgewählte Formel/Bild wieder frei.
    if (e.key === 'Escape') {
      selectBlock(null)
      return
    }
    if (e.key !== 'Tab') return
    e.preventDefault()

    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return

    let node: Node | null = sel.anchorNode
    let li: Node | null = null
    while (node && node !== editor) {
      if (node.nodeName === 'LI') {
        li = node
        break
      }
      node = node.parentNode
    }

    if (li) {
      document.execCommand(e.shiftKey ? 'outdent' : 'indent')
    } else if (e.shiftKey) {
      removeIndentAtCursor()
    } else {
      insertTabAtCursor()
    }
  }

  // --- Bilder: Datei-Picker + Strg+V (slice 8, #36; reference L1170–1191,
  // L1429–1454). Deviation from the reference's FileReader flow (approved in
  // #36 planning): the immediate preview is a blob: object URL instead of a
  // base64 data URL — no base64 string ever exists in the DOM — and the src
  // is swapped to the signed-URL proxy route once the upload returns. The
  // serializer only ever reads data-image-id, never src.

  const pendingObjectUrls = new Set<string>()

  function releaseObjectUrl(url: string) {
    if (pendingObjectUrls.delete(url)) URL.revokeObjectURL(url)
  }

  function createImageBlockElement(previewSrc: string, alt: string): HTMLElement {
    const block = document.createElement('div')
    block.className = 'image-block is-uploading'
    block.setAttribute('draggable', 'true')
    const handle = document.createElement('span')
    handle.className = 'drag-handle'
    handle.setAttribute('contenteditable', 'false')
    handle.textContent = '❚❚'
    const img = document.createElement('img')
    img.src = previewSrc
    img.alt = alt
    img.setAttribute('contenteditable', 'false')
    block.appendChild(handle)
    block.appendChild(img)
    // Lösch-✕ (#44) — identische Chrome wie im Import-Renderer; der Klick wird
    // in onEditorClick delegiert.
    block.appendChild(createImageRemoveButton(document))
    return block
  }

  async function insertImageFromFile(file: File, alt?: string): Promise<void> {
    // Client-side pre-check (German messages, #36 acceptance criterion) —
    // also protects the 4-MB server-action body limit. Wording matches the
    // server action's own validation.
    if (!(ALLOWED_IMAGE_MIMES as readonly string[]).includes(file.type)) {
      window.alert(`"${file.name}" ist kein unterstütztes Bildformat (JPEG, PNG, GIF, WebP).`)
      return
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      window.alert(
        `"${file.name}" ist zu groß (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximal 4 MB pro Bild.`
      )
      return
    }

    // Sofort sichtbar einfügen (reference parity), Upload läuft im Hintergrund.
    const objectUrl = URL.createObjectURL(file)
    pendingObjectUrls.add(objectUrl)
    const block = createImageBlockElement(objectUrl, alt ?? file.name ?? 'Bild')
    const trailing = document.createElement('p')
    trailing.innerHTML = '<br>'
    insertBlockAtCursor(block, trailing)

    const result = await hooks.uploadImage(file)
    if (!result.ok) {
      block.remove()
      releaseObjectUrl(objectUrl)
      window.alert(`Bild-Upload fehlgeschlagen: ${result.error}`)
      return
    }
    const img = block.querySelector<HTMLImageElement>('img')
    if (!img) {
      // Block wurde während des Uploads gelöscht — die verwaiste Zeile räumt
      // die Save-Reconciliation beim nächsten Speichern ab.
      releaseObjectUrl(objectUrl)
      return
    }
    // Vorschau → Storage-Referenz. Das blob: wird erst nach dem Laden der
    // Proxy-Antwort freigegeben, damit der Block nie leer aufblitzt.
    img.dataset['imageId'] = result.imageId
    const finish = () => {
      img.removeEventListener('load', finish)
      img.removeEventListener('error', finish)
      releaseObjectUrl(objectUrl)
      block.classList.remove('is-uploading')
    }
    img.addEventListener('load', finish)
    img.addEventListener('error', finish)
    img.src = editorImageUrl(result.imageId)
  }

  // Strg+V für Bilder (reference L1429): das erste image/*-Item wird als
  // Datei eingefügt; preventDefault verhindert, dass der Browser ein
  // base64-<img> in den Text schreibt (PRD-Verbot).
  const onPaste = (e: ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of Array.from(items)) {
      if (item.type && item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (!file) continue
        saveSelection()
        void insertImageFromFile(file, 'pasted')
        return
      }
    }
  }

  // Effektive Schriftgröße am Auswahlanker als Ganzzahl-px-String (#43).
  // getComputedStyle löst die Kaskade auf, liefert also automatisch die Größe
  // des nächstgelegenen Style-Spans bzw. — bei kollabiertem Cursor hinter einem
  // Span oder in Normaltext — die des Blocks. '' wenn nicht ermittelbar.
  function currentSelectionFontSize(): string {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || !editor.contains(sel.anchorNode)) return ''
    const node = sel.anchorNode
    const el =
      node && node.nodeType === Node.ELEMENT_NODE
        ? (node as Element)
        : (node?.parentElement ?? null)
    if (!el || !editor.contains(el)) return ''
    const match = /^(\d+(?:\.\d+)?)px$/.exec(window.getComputedStyle(el).fontSize)
    if (!match) return ''
    return String(Math.round(parseFloat(match[1]!)))
  }

  // savedRange immer aktuell halten, solange im Editor getippt/geklickt wird
  const onSelectionChange = () => {
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
      state.savedRange = sel.getRangeAt(0).cloneRange()
      // #92: der Cursor im Editor ist die jüngere Zielangabe — die
      // Blockauswahl per Ziehgriff verfällt. Der Guard oben ist der Grund,
      // warum ein Klick auf die ⚓-Schaltfläche sie NICHT verwirft: dabei
      // wandert die Selektion aus dem Editor heraus. Der Ziehgriff-Klick
      // selbst ist ebenfalls sicher — selectionchange läuft beim mousedown,
      // also vor dem click-Handler, der die Auswahl setzt.
      selectBlock(null)
      callbacks.onSelectionFontSize?.(currentSelectionFontSize())
    }
  }

  // Klick auf eine Input/Output-Pille öffnet das Feld-Modal, Klick auf eine
  // gerenderte Formel das Bearbeiten-Modal. Pill clicks are DELEGATED here —
  // approved deviation from the reference's per-span listeners (base L1726,
  // FINAL PATCH fieldClick): identical behavior for every pill the editor
  // creates, plus it revives pills the browser clones during contenteditable
  // editing (copy/paste), which are click-dead in the reference.
  const onEditorClick = (e: MouseEvent) => {
    const clicked = e.target instanceof Element ? e.target : null
    // #92: ein Klick (kein Zug) auf den Ziehgriff wählt den Block aus, damit
    // die ⚓-Schaltfläche bei Formel- und Bildblöcken ein Ziel hat. Ein
    // abgeschlossener HTML5-Drag löst gar kein click-Event aus — Umsortieren
    // wählt also nie versehentlich aus.
    const handle = clicked?.closest<HTMLElement>('.drag-handle')
    if (handle && editor.contains(handle)) {
      e.preventDefault()
      e.stopPropagation()
      selectBlock(handle.closest<HTMLElement>('.formula-block, .image-block'))
      return
    }
    // Lösch-✕ eines Bildblocks (#44): ganzen .image-block entfernen. Delegiert
    // wie die Pillen unten — greift auch für vom Browser geklonte Buttons.
    const removeBtn = clicked?.closest<HTMLElement>('.img-remove')
    if (removeBtn && editor.contains(removeBtn)) {
      e.preventDefault()
      e.stopPropagation()
      removeBtn.closest<HTMLElement>('.image-block')?.remove()
      return
    }
    const pill = clicked?.closest<HTMLElement>('.input-field, .output-field')
    if (pill && editor.contains(pill)) {
      e.stopPropagation()
      openFieldModal(pill.dataset['fieldId'] ?? '')
      return
    }
    // Klick auf einen Link-Chip öffnet den Ziel-Picker (#72) — dieselbe
    // Delegation wie bei den Pillen, aus demselben Grund, und die EINZIGE
    // verlässliche Bearbeitungsgeste: der Chip ist contenteditable="false",
    // also lässt sich der Cursor nicht in ihn setzen.
    const chip = clicked?.closest<HTMLElement>(LINK_CHIP_SELECTOR)
    if (chip && editor.contains(chip)) {
      e.preventDefault()
      e.stopPropagation()
      void runLinkPicker(chip)
      return
    }
    const target = clicked?.closest('.render-target')
    if (!target) return
    const block = target.closest<HTMLElement>('.formula-block')
    if (!block) return
    e.stopPropagation()
    openLatexModal(block)
  }

  // --- Drag & Drop: Blocks verschieben + Bibliothek einfügen (slice 4, #32) ---
  // Base script L1966–2092, never patched. The capture-phase field-drop
  // handlers (slice 5, #33) run BEFORE these bubble handlers and stop
  // field-id drags entirely.

  // Caret-Range an Bildschirmposition (WebKit caretRangeFromPoint bzw.
  // Standard caretPositionFromPoint) — shared by the library drop and the
  // inline drop caret (identical inline blocks in the reference).
  function caretRangeAtPoint(clientX: number, clientY: number): Range | null {
    if (document.caretRangeFromPoint) {
      return document.caretRangeFromPoint(clientX, clientY)
    }
    if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(clientX, clientY)
      if (pos) {
        const r = document.createRange()
        r.setStart(pos.offsetNode, pos.offset)
        r.collapse(true)
        return r
      }
    }
    return null
  }

  let dragEl: HTMLElement | null = null
  let dropIndicator: HTMLElement | null = null
  let inlineDropCaret: HTMLElement | null = null

  // #45: Auto-Scroll beim Blockziehen. Der .editor-scroll-Container hat feste
  // Höhe; bei Dokumenten, die höher sind als das Sichtfenster, ließen sich
  // Drop-Ziele außerhalb des sichtbaren Bereichs nicht erreichen, weil ein
  // aktiver Drag das normale Scrollen blockiert. Solange der Zeiger in der
  // oberen/unteren Randzone hängt, scrollt ein Intervall in fester Schrittweite.
  const AUTO_SCROLL_EDGE = 48 // px Randzone oben/unten
  const AUTO_SCROLL_STEP = 12 // px pro Tick
  let autoScrollDir = 0
  let autoScrollTimer: ReturnType<typeof setInterval> | null = null

  function stopAutoScroll() {
    if (autoScrollTimer !== null) {
      clearInterval(autoScrollTimer)
      autoScrollTimer = null
    }
    autoScrollDir = 0
  }

  function updateAutoScroll(clientY: number) {
    const rect = editorScroll.getBoundingClientRect()
    if (clientY < rect.top + AUTO_SCROLL_EDGE) {
      autoScrollDir = -1
    } else if (clientY > rect.bottom - AUTO_SCROLL_EDGE) {
      autoScrollDir = 1
    } else {
      stopAutoScroll()
      return
    }
    if (autoScrollTimer === null) {
      autoScrollTimer = setInterval(() => {
        editorScroll.scrollTop += autoScrollDir * AUTO_SCROLL_STEP
      }, 16)
    }
  }

  function ensureDropIndicator(): HTMLElement {
    if (!dropIndicator) {
      dropIndicator = document.createElement('div')
      dropIndicator.className = 'drop-indicator'
    }
    return dropIndicator
  }

  function removeDropIndicator() {
    if (dropIndicator && dropIndicator.parentNode) {
      dropIndicator.parentNode.removeChild(dropIndicator)
    }
  }

  // (The parameter deliberately shadows the outer mount container — it is
  // always called with `editor`, matching the reference signature.)
  function getDragAfterElement(container: HTMLElement, y: number): Element | null {
    // #hiddenFields is the hidden field store (slice 5, #33) — fields that
    // only live inside LaTeX formulas; never a target for block sorting.
    const elements = [...container.children].filter(
      (el) => el !== dragEl && el !== dropIndicator && el.id !== 'hiddenFields'
    )
    let closest: { offset: number; element: Element | null } = {
      offset: Number.NEGATIVE_INFINITY,
      element: null,
    }
    for (const el of elements) {
      const box = el.getBoundingClientRect()
      const offset = y - box.top - box.height / 2
      if (offset < 0 && offset > closest.offset) {
        closest = { offset, element: el }
      }
    }
    return closest.element
  }

  // .image-block blocks arrive with slice 8 (#36); the selectors are ported
  // verbatim so their reordering works the moment they exist.
  const onDragStart = (e: DragEvent) => {
    const targetEl = e.target instanceof Element ? e.target : null
    const block = targetEl?.closest<HTMLElement>('.formula-block, .image-block')
    if (!block) return
    dragEl = block
    setTimeout(() => block.classList.add('dragging'), 0)
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', 'block-drag')
    }
  }

  const onDragEnd = () => {
    if (dragEl) dragEl.classList.remove('dragging')
    removeDropIndicator()
    stopAutoScroll()
    dragEl = null
  }

  const onDragOver = (e: DragEvent) => {
    if (dragEl) {
      e.preventDefault()
      updateAutoScroll(e.clientY)
      const afterEl = getDragAfterElement(editor, e.clientY)
      const indicator = ensureDropIndicator()
      if (afterEl == null) {
        editor.appendChild(indicator)
      } else {
        editor.insertBefore(indicator, afterEl)
      }
    } else if (
      e.dataTransfer &&
      (e.dataTransfer.types.includes('application/x-latex') ||
        e.dataTransfer.types.includes('application/x-field-id'))
    ) {
      // application/x-field-id is checked here as in the reference's base
      // handler (L2024), but DORMANT by design: the capture-phase
      // onFieldDragOverCapture stops those events first, so variable drags
      // never reach this bubble handler and get no inline drop caret —
      // exactly the reference's composed behavior.
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      showInlineDropCaret(e.clientX, e.clientY)
    }
  }

  const onDragLeave = (e: DragEvent) => {
    // Nur entfernen, wenn der Mauszeiger den Editor wirklich verlässt (nicht nur ein Kind-Element)
    if (e.target === editor) hideInlineDropCaret()
  }

  const onDrop = (e: DragEvent) => {
    hideInlineDropCaret()
    stopAutoScroll()
    if (dragEl) {
      e.preventDefault()
      const afterEl = getDragAfterElement(editor, e.clientY)
      removeDropIndicator()
      if (afterEl == null) {
        editor.appendChild(dragEl)
      } else {
        editor.insertBefore(dragEl, afterEl)
      }
      // A block reorder fires no `input` event, so the anchor sweep has to be
      // invoked here too. Moving a marked block is not duplicating it — the
      // registry recognises the same element and leaves its id alone.
      anchorRegistry.sweep()
      return
    }
    if (!e.dataTransfer) return

    // 'application/x-field-id' drops never arrive here: the capture-phase
    // onFieldDropCapture handles them and stops propagation — just as the
    // reference's FINAL PATCH preempted its own bubble handler (L2050–2055).

    const latex = e.dataTransfer.getData('application/x-latex')
    if (latex) {
      e.preventDefault()
      void insertFormulaFromLibraryAt(latex, e.clientX, e.clientY)
    }
  }

  // --- Live-Drop-Vorschau ---

  function showInlineDropCaret(clientX: number, clientY: number) {
    hideInlineDropCaret()
    const dropRange = caretRangeAtPoint(clientX, clientY)
    if (!dropRange || !editor.contains(dropRange.startContainer)) return
    inlineDropCaret = document.createElement('span')
    inlineDropCaret.className = 'inline-drop-caret'
    inlineDropCaret.setAttribute('contenteditable', 'false')
    try {
      dropRange.insertNode(inlineDropCaret)
    } catch {
      inlineDropCaret = null
    }
  }

  function hideInlineDropCaret() {
    if (inlineDropCaret && inlineDropCaret.parentNode) {
      inlineDropCaret.parentNode.removeChild(inlineDropCaret)
    }
    inlineDropCaret = null
  }

  // #44: Löscht der Nutzer das <img> per Tastatur (Bild markieren + Entf),
  // bleibt sonst der leere .image-block-Rahmen (Formel-Box + Drag-Handle)
  // zurück. Wir beobachten das Entfernen von Bildknoten und räumen den dann
  // bildlosen Block ab. Deckt jeden Löschweg ab (Entf, Backspace, Ausschneiden)
  // — robuster als ein Entf-Keydown-Abfang. Blöcke entstehen nie ohne <img>
  // (createImageBlockElement/Import bauen sie komplett vor dem Einfügen), daher
  // ist „image-block ohne img" eindeutig ein gelöschtes Bild.
  const imageCleanupObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type !== 'childList' || m.removedNodes.length === 0) continue
      let removedImg = false
      m.removedNodes.forEach((n) => {
        if (n.nodeName === 'IMG' || (n instanceof Element && n.querySelector('img'))) {
          removedImg = true
        }
      })
      if (!removedImg) continue
      const target = m.target instanceof Element ? m.target : null
      const block = target?.closest<HTMLElement>('.image-block')
      if (block && editor.contains(block) && !block.querySelector('img')) block.remove()
    }
  })
  imageCleanupObserver.observe(editor, { childList: true, subtree: true })

  editor.addEventListener('keydown', onKeyDown)
  editor.addEventListener('paste', onPaste)
  editor.addEventListener('click', onEditorClick)
  editor.addEventListener('input', onEditorInput)
  editor.addEventListener('dragstart', onDragStart)
  editor.addEventListener('dragend', onDragEnd)
  editor.addEventListener('dragover', onDragOver)
  editor.addEventListener('dragleave', onDragLeave)
  editor.addEventListener('drop', onDrop)
  editor.addEventListener('focus', () => {
    lastFocused = 'editor'
  })
  // Capture phase (true): field drops must win over every bubble handler
  // (FINAL PATCH L2235).
  for (const el of [editor, editorScroll, exportArea]) {
    el.addEventListener('dragover', onFieldDragOverCapture, true)
    el.addEventListener('drop', onFieldDropCapture, true)
  }
  document.addEventListener('selectionchange', onSelectionChange)

  latexInput.addEventListener('focus', () => {
    lastFocused = 'latex'
  })
  latexInput.addEventListener('input', updateLatexPreview)
  latexDeleteBtn.addEventListener('click', deleteCurrentFormula)
  latexCancelBtn.addEventListener('click', closeLatexModal)
  latexCodeblockBtn.addEventListener('click', insertLatexCodeblock)
  latexApplyBtn.addEventListener('click', () => {
    void insertLatexRendered()
  })
  // Parity port of the reference's overlay background click-to-close
  // (L1355). Dead in practice for #latexOverlay — its pointer-events:none
  // background never receives clicks (that is what keeps the floating panel
  // non-blocking) — but live for the blocking field overlay below.
  latexOverlay.addEventListener('click', (e) => {
    if (e.target instanceof HTMLElement && e.target.id === 'latexOverlay') closeLatexModal()
  })

  fieldRefTypeSelect.addEventListener('change', onFieldRefTypeChange)
  fieldDeleteBtn.addEventListener('click', deleteCurrentField)
  fieldCancelBtn.addEventListener('click', closeFieldModal)
  fieldSaveBtn.addEventListener('click', saveFieldFromModal)
  // Hintergrund-Klick schließt das Feld-Modal (reference L1953).
  fieldOverlay.addEventListener('click', (e) => {
    if (e.target instanceof HTMLElement && e.target.id === 'fieldOverlay') closeFieldModal()
  })

  jsonCancelBtn.addEventListener('click', closeJsonImportModal)
  jsonExampleBtn.addEventListener('click', fillJsonExample)
  jsonImportBtn.addEventListener('click', () => {
    void importJsonFromModal()
  })
  // Hintergrund-Klick schließt das JSON-Modal (reference L2349).
  jsonOverlay.addEventListener('click', (e) => {
    if (e.target instanceof HTMLElement && e.target.id === 'jsonOverlay') closeJsonImportModal()
  })

  // 1-Sekunden-Sweep (FINAL PATCH L2297): getippte Platzhalter umwandeln,
  // dann alle Felder aktualisieren; der Guard verhindert Überlappung.
  let sweepRunning = false
  const fieldSweepInterval = setInterval(() => {
    if (sweepRunning) return
    sweepRunning = true
    try {
      convertTypedFieldPlaceholders()
      updateAllFields()
    } finally {
      sweepRunning = false
    }
  }, 1000)

  function destroy() {
    clearInterval(fieldSweepInterval)
    clearTimeout(latexPreviewTimer)
    stopAutoScroll()
    imageCleanupObserver.disconnect()
    document.removeEventListener('selectionchange', onSelectionChange)
    editor.removeEventListener('keydown', onKeyDown)
    editor.removeEventListener('paste', onPaste)
    editor.removeEventListener('click', onEditorClick)
    editor.removeEventListener('input', onEditorInput)
    editor.removeEventListener('dragstart', onDragStart)
    editor.removeEventListener('dragend', onDragEnd)
    editor.removeEventListener('dragover', onDragOver)
    editor.removeEventListener('dragleave', onDragLeave)
    editor.removeEventListener('drop', onDrop)
    for (const el of [editor, editorScroll, exportArea]) {
      el.removeEventListener('dragover', onFieldDragOverCapture, true)
      el.removeEventListener('drop', onFieldDropCapture, true)
    }
    for (const url of pendingObjectUrls) URL.revokeObjectURL(url)
    pendingObjectUrls.clear()
    selectedBlock = null
    dragEl = null
    dropIndicator = null
    inlineDropCaret = null
    container.innerHTML = ''
  }

  return {
    exec,
    formatBlock,
    applyStyles,
    applyFontSize,
    applyTemplate,
    clearHighlight,
    saveSelection,
    openLatexModal,
    insertInputField: () => insertField('input'),
    insertOutputField: () => insertField('output'),
    markAnchor,
    insertLink,
    resetEditor,
    insertImageFromFile: (file: File, alt?: string) => {
      void insertImageFromFile(file, alt)
    },
    exportDocument,
    loadDocument,
    openJsonImportModal,
    // The pipeline lives in png-export.ts; the controller only supplies its
    // own DOM (export area + scroll box stay encapsulated here).
    exportToPng: (options?: PngExportOptions) =>
      exportAreaToPngBlob(exportArea, editorScroll, options),
    destroy,
  }
}
