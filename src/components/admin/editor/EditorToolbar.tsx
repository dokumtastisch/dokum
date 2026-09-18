'use client'

import { useRef, type RefObject } from 'react'
import type { EditorController } from '@/lib/editor/controller'

/**
 * Rich-text toolbar of the LaTeX editor (slice 1 of PRD #28).
 *
 * Markup and labels are a 1:1 port of the standalone editor's toolbar
 * (reference file in latexEditor/). LaTeX arrived with slice 3, Input/Output
 * with slice 5, „Bild einfügen" with slice 8 (reference L541–542:
 * saveSelection() before opening the file dialog, value reset after pick).
 *
 * All controls are uncontrolled and call straight into the imperative
 * controller — no React state, so typing in the contenteditable surface
 * never triggers a re-render.
 */

const FONT_SIZES = ['12', '14', '16', '18', '20', '24', '28', '32']

const TEMPLATES: { label: string; color: string; px: number; bold: boolean }[] = [
  { label: 'Schwarz 18', color: '#111827', px: 18, bold: false },
  { label: 'Schwarz 24', color: '#111827', px: 24, bold: true },
  { label: 'Orange 18', color: '#e8722c', px: 18, bold: false },
  { label: 'Cyan 18', color: '#06b6d4', px: 18, bold: false },
  { label: 'Lila 18', color: '#7c3aed', px: 18, bold: false },
]

const LABEL_STYLE = { fontSize: 12, color: '#6b7280' } as const

export function EditorToolbar({
  controllerRef,
  sizeFromSelection = '',
}: {
  controllerRef: RefObject<EditorController | null>
  /**
   * Effective font size of the current editor selection (#43), pushed from the
   * controller via the shell. Reflected in the size dropdown when it matches a
   * known option; otherwise the dropdown shows its „Größe" placeholder.
   */
  sizeFromSelection?: string
}) {
  const ctrl = () => controllerRef.current
  const imageInputRef = useRef<HTMLInputElement>(null)
  const sizeValue = FONT_SIZES.includes(sizeFromSelection) ? sizeFromSelection : ''

  return (
    <div className="toolbar">
      <div className="group">
        <button type="button" onClick={() => ctrl()?.exec('bold')}>
          <b>B</b>
        </button>
        <button type="button" onClick={() => ctrl()?.exec('italic')}>
          <i>I</i>
        </button>
        <button type="button" onClick={() => ctrl()?.exec('underline')}>
          <u>U</u>
        </button>
        <button type="button" onClick={() => ctrl()?.exec('strikeThrough')}>
          <s>S</s>
        </button>
      </div>
      <div className="sep" />
      <div className="group">
        <select
          aria-label="Format"
          defaultValue=""
          onChange={(e) => ctrl()?.formatBlock(e.target.value)}
        >
          <option value="">Format</option>
          <option value="H1">H1</option>
          <option value="H2">H2</option>
          <option value="P">Normal</option>
          <option value="PRE">Codeblock</option>
        </select>
        <button type="button" onClick={() => ctrl()?.exec('insertUnorderedList')}>
          &bull; Liste
        </button>
        <button type="button" onClick={() => ctrl()?.exec('insertOrderedList')}>
          1. Liste
        </button>
      </div>
      <div className="sep" />
      <div className="group">
        <label style={LABEL_STYLE}>Text</label>
        <input
          type="color"
          aria-label="Textfarbe"
          defaultValue="#111827"
          onInput={(e) => ctrl()?.applyStyles({ color: e.currentTarget.value })}
        />
        <label style={LABEL_STYLE}>Highlight</label>
        <input
          type="color"
          aria-label="Highlightfarbe"
          defaultValue="#fff3b0"
          onInput={(e) => ctrl()?.applyStyles({ backgroundColor: e.currentTarget.value })}
        />
        <button
          type="button"
          className="clear-highlight"
          aria-label="Kein Highlight"
          title="Highlight entfernen"
          onClick={() => ctrl()?.clearHighlight()}
        >
          ✕
        </button>
        <label style={LABEL_STYLE}>Größe</label>
        <select
          aria-label="Schriftgröße"
          // Controlled by the live selection (#43): after applying, the cursor
          // collapses into the block and selectionchange reflects the block's
          // size here — superseding the reference's manual reset-to-placeholder.
          value={sizeValue}
          onChange={(e) => ctrl()?.applyFontSize(e.target.value)}
        >
          <option value="">Größe</option>
          {FONT_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </div>
      <div className="sep" />
      <div className="group">
        {TEMPLATES.map((t) => (
          <button
            key={t.label}
            type="button"
            className="template-btn"
            onClick={() => ctrl()?.applyTemplate(t.color, t.px, t.bold)}
          >
            <span className="swatch" style={{ background: t.color }} />
            {t.label}
          </button>
        ))}
      </div>
      <div className="sep" />
      <div className="group">
        <button type="button" aria-label="Linksbündig" onClick={() => ctrl()?.exec('justifyLeft')}>
          {'⇤'}
        </button>
        <button type="button" aria-label="Zentriert" onClick={() => ctrl()?.exec('justifyCenter')}>
          {'↔'}
        </button>
        <button type="button" aria-label="Rechtsbündig" onClick={() => ctrl()?.exec('justifyRight')}>
          {'⇥'}
        </button>
      </div>
      <div className="sep" />
      <div className="group">
        {/* .accent replaces the reference's [onclick*="openLatexModal"] selector (see editor.css) */}
        <button type="button" className="accent" onClick={() => ctrl()?.openLatexModal()}>
          ƒ(x) LaTeX einfügen
        </button>
        <button
          type="button"
          onClick={() => {
            // Reference L541: snapshot the selection BEFORE the file dialog
            // steals focus — the picked image is inserted at this position.
            ctrl()?.saveSelection()
            imageInputRef.current?.click()
          }}
        >
          📷 Bild einfügen
        </button>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0]
            // Reference L1172: reset so picking the same file twice re-fires.
            e.target.value = ''
            if (file) ctrl()?.insertImageFromFile(file)
          }}
        />
        {/* Reference order (L543–544): Input/Output sit between image insert and reset. */}
        <button type="button" onClick={() => ctrl()?.insertInputField()}>
          ☐ Input
        </button>
        <button type="button" onClick={() => ctrl()?.insertOutputField()}>
          ☑ Output
        </button>
        {/* #71: marks the block at the cursor as a link target. Deliberately
            NOT preceded by saveSelection() (unlike „Bild einfügen"): the button
            takes focus before its handler runs, and saveSelection() would then
            null out the very range the controller needs. The controller reads
            the selectionchange-maintained range instead. */}
        <button
          type="button"
          title="Diesen Block als Sprungmarke markieren, umbenennen oder die Markierung entfernen. Formel- und Bildblöcke zuvor mit einem Klick auf ihren Ziehgriff ❚❚ auswählen."
          onClick={() => ctrl()?.markAnchor()}
        >
          ⚓ Sprungmarke
        </button>
        {/* #72: Link auf einen veröffentlichten Kurs, eine Einheit, ein
            Dokument oder eine Sprungmarke darin. Wie bei ⚓ bewusst OHNE
            saveSelection(): die Schaltfläche nimmt vor ihrem Handler den Fokus,
            und saveSelection() würde genau den markierten Bereich verwerfen,
            aus dem die Beschriftung entsteht. */}
        <button
          type="button"
          title="Link auf einen veröffentlichten Kurs, eine Einheit, ein Dokument oder eine Sprungmarke einfügen. Markierter Text wird zur Beschriftung. Einen bestehenden Link bearbeitest du mit einem Klick darauf."
          onClick={() => ctrl()?.insertLink()}
        >
          🔗 Link
        </button>
        <button type="button" onClick={() => ctrl()?.resetEditor()}>
          Editor zurücksetzen
        </button>
      </div>
      <div className="sep" />
      <div className="group">
        {/* Reference L2369–2386: the JSON-import patch appends its own toolbar
            group with an "Add JSON" button (label parity, German tooltip). */}
        <button
          type="button"
          title="JSON-Dokument importieren"
          onClick={() => ctrl()?.openJsonImportModal()}
        >
          Add JSON
        </button>
      </div>
    </div>
  )
}
