/**
 * inline-markup — the text an author types ⇄ the inline nodes a Lernseite
 * stores (#107).
 *
 * WHY A MARKUP SYNTAX AND NOT A RICH-TEXT SURFACE. A paragraph can hold bold
 * runs, inline formulas and defined terms. Editing that WYSIWYG means a
 * contenteditable, and this codebase already knows exactly what that costs —
 * the LaTeX editor is an imperative controller with a selection to save and
 * restore, block cloning to sweep and a parity suite pinning its behaviour. A
 * `<textarea>` plus these two functions gets the same expressiveness with none
 * of it, and the whole conversion is pure, so it is provable rather than
 * clicked through.
 *
 * It is explicitly a STAGE, not the destination. The model (lesson-json.ts) is
 * the durable thing; this is one way of typing into it. A rich-text surface can
 * replace the textarea later and produce the same nodes — nothing stored
 * depends on this syntax existing.
 *
 * The syntax, chosen to look like what people already type:
 *
 *   **fett**              → { text, bold }
 *   *kursiv*              → { text, italic }
 *   ***beides***          → { text, bold, italic }
 *   $E[R_i]$              → { type: 'math', latex }
 *   [[Begriff|Erklärung]] → { type: 'term', label, definition }
 *   \$ \* \[ \\           → the literal character
 *
 * TWO RULES MAKE IT SAFE TO ROUND-TRIP:
 *
 * 1. **An unclosed marker is text, not an error.** Someone typing „Kosten von
 *    $5" has written a dollar sign, and a parser that swallowed the rest of the
 *    paragraph looking for its partner would eat their work. Every opener that
 *    finds no closer degrades to the literal character.
 * 2. **Serialising escapes exactly what parsing would otherwise consume**, so
 *    `parse(serialize(nodes))` returns `nodes` for every value the model can
 *    hold — including text that contains dollar signs and asterisks. That is
 *    the property the tests pin, because it is what stands between an author
 *    and silently corrupted content on the second save.
 */

import type { LessonInline } from './lesson-json'

/** Characters that would otherwise open a construct and so must be escaped. */
const ESCAPABLE = new Set(['\\', '$', '*'])

// ── Parsing ─────────────────────────────────────────────────────────────────

/**
 * Turns authored text into inline nodes.
 *
 * Adjacent literal characters are merged into ONE string node, so the result is
 * the same shape a hand-written lesson uses and round-tripping is stable.
 */
export function parseInlineMarkup(text: string): LessonInline[] {
  const nodes: LessonInline[] = []
  let buffer = ''

  const flush = () => {
    if (buffer) {
      nodes.push(buffer)
      buffer = ''
    }
  }

  let i = 0
  while (i < text.length) {
    const char = text[i]

    // An escape consumes the backslash and takes the next character literally.
    // A trailing backslash is a literal backslash — there is nothing to escape.
    if (char === '\\' && i + 1 < text.length) {
      buffer += text[i + 1]
      i += 2
      continue
    }

    if (char === '$') {
      const close = findUnescaped(text, '$', i + 1)
      if (close !== -1) {
        flush()
        nodes.push({ type: 'math', latex: unescape(text.slice(i + 1, close)) })
        i = close + 1
        continue
      }
    }

    if (char === '[' && text.startsWith('[[', i)) {
      // Both searches must skip escaped characters. A definition is free text
      // and may legitimately contain `|` or `]]`; the serializer escapes them,
      // and a plain `indexOf` would split the term at the escaped one and hand
      // back a mangled label — which is exactly what the round-trip test
      // caught here.
      const close = findUnescaped(text, ']]', i + 2)
      if (close !== -1) {
        const inner = text.slice(i + 2, close)
        const separator = findUnescaped(inner, '|', 0)
        // Both halves must be non-empty — the model requires a label AND a
        // definition, and a half-typed term is text the author is still
        // writing, not a validation failure to shout about.
        if (separator > 0 && separator < inner.length - 1) {
          flush()
          nodes.push({
            type: 'term',
            label: unescape(inner.slice(0, separator)),
            definition: unescape(inner.slice(separator + 1)),
          })
          i = close + 2
          continue
        }
      }
    }

    if (char === '*') {
      // Longest marker first: `***` would otherwise parse as `**` followed by
      // a stray `*`.
      const emphasis =
        readEmphasis(text, i, '***', { bold: true, italic: true }) ??
        readEmphasis(text, i, '**', { bold: true }) ??
        readEmphasis(text, i, '*', { italic: true })
      if (emphasis) {
        flush()
        nodes.push(emphasis.node)
        i = emphasis.end
        continue
      }
    }

    buffer += char
    i += 1
  }

  flush()
  return nodes
}

/**
 * Reads `marker … marker` at `start`. Returns null when the marker does not
 * open here, when it never closes, or when it would wrap nothing — `****` is
 * four asterisks, not empty bold text.
 */
function readEmphasis(
  text: string,
  start: number,
  marker: string,
  style: { bold?: boolean; italic?: boolean }
): { node: LessonInline; end: number } | null {
  if (!text.startsWith(marker, start)) return null
  const from = start + marker.length
  const close = findUnescaped(text, marker, from)
  if (close === -1 || close === from) return null
  return {
    node: { text: unescape(text.slice(from, close)), ...style },
    end: close + marker.length,
  }
}

/** Index of the next `needle` not preceded by a backslash, or -1. */
function findUnescaped(text: string, needle: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    if (text[i] === '\\') {
      i += 1
      continue
    }
    if (text.startsWith(needle, i)) return i
  }
  return -1
}

/** Drops one level of backslash escaping from an already-delimited slice. */
function unescape(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\' && i + 1 < text.length) {
      out += text[i + 1]
      i += 1
      continue
    }
    out += text[i]
  }
  return out
}

// ── Serialising ─────────────────────────────────────────────────────────────

/** Turns stored inline nodes back into the text an author edits. */
export function serializeInlineMarkup(nodes: readonly LessonInline[]): string {
  return nodes.map(serializeNode).join('')
}

function serializeNode(node: LessonInline): string {
  if (typeof node === 'string') return escapeLiteral(node)

  if ('text' in node) {
    const marker = node.bold && node.italic ? '***' : node.bold ? '**' : node.italic ? '*' : ''
    // A run with no style is indistinguishable from plain text and is written
    // as such — otherwise round-tripping would invent `` around it.
    return marker + escapeLiteral(node.text) + marker
  }

  if (node.type === 'math') return '$' + escapeInside(node.latex, '$') + '$'

  return '[[' + escapeInside(node.label, '|') + '|' + escapeInside(node.definition, '|') + ']]'
}

/**
 * Escapes literal text so parsing gives it back unchanged.
 *
 * `[` is escaped ONLY where it would open a term. Escaping every one of them
 * would turn `E[R_i]` — which authors write constantly — into `E\[R_i]` on
 * every save, and the noise would be blamed on the editor, correctly.
 */
function escapeLiteral(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (ESCAPABLE.has(char)) {
      out += '\\' + char
      continue
    }
    if (char === '[' && text.startsWith('[[', i)) {
      out += '\\['
      continue
    }
    out += char
  }
  return out
}

/**
 * Escapes inside a delimited construct: the backslash, the closing delimiter,
 * and `]` where it would end a term early. LaTeX is full of backslashes, so
 * this is the function that has to be right for formulas to survive a save.
 */
function escapeInside(text: string, delimiter: string): string {
  let out = ''
  for (const char of text) {
    if (char === '\\' || char === delimiter || char === ']') out += '\\'
    out += char
  }
  return out
}
