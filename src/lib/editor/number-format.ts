/**
 * German display number formatting for the LaTeX editor (PRD #28, slice 2 — #30).
 *
 * Exact port of the standalone editor's final `formatValue` (reference file
 * latexEditor/latex_editor_FIXED_JSON_IMPORT_COMPLETE_OUTPUT_AS_INPUT_LATEX_FIX.htm.html,
 * "PATCH ONLY: simple display formatting" layer, line 2629), which supersedes
 * the base script's version (line 1618).
 *
 * Behavior (the golden tests are the parity contract):
 * - Non-finite values (NaN, ±Infinity) → `'—'`.
 * - Negative zero is normalised to `'0'` — both for a `-0` input and when
 *   rounding collapses a small negative value to zero.
 * - Decimals depend on the magnitude of the ORIGINAL value:
 *   |v| > 1000 → 0, |v| < 1 → 4, |v| < 10 → 3, otherwise 2.
 * - Trailing zeros in the fraction are trimmed (`2,500` → `2,5`).
 * - Thousands are grouped with spaces, the decimal separator is a comma.
 *
 * Pure and DOM-free — reusable by the future student-facing renderer.
 */

function decimalsFor(v: number): number {
  const a = Math.abs(v)
  if (a > 1000) return 0
  if (a < 1) return 4
  if (a < 10) return 3
  return 2
}

function trimTrailingZeros(s: string): string {
  return s.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '')
}

function groupThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

/** Formats a computed field value for display, German style. */
export function formatValue(v: number): string {
  if (!Number.isFinite(v)) return '—'
  if (Object.is(v, -0)) v = 0
  const dec = decimalsFor(v)
  let r = Number(v.toFixed(dec))
  if (Object.is(r, -0)) r = 0
  const sign = r < 0 ? '-' : ''
  const raw = trimTrailingZeros(Math.abs(r).toFixed(dec))
  const parts = raw.split('.')
  return sign + groupThousands(parts[0] || '0') + (parts[1] ? ',' + parts[1] : '')
}

// ── Number ENTRY, not display (#68) ─────────────────────────────────────────
//
// Not part of the parity port above: nothing in the reference editor reads a
// number a human typed, because only an admin ever set a value there, through
// a modal. A student typing into the document needs the round trip, and it has
// to be LOSSLESS — `formatValue` is not, it rounds by magnitude, so putting a
// value through it and back would quietly change the document's numbers.
//
// The pair below is exact in both directions: a decimal comma is all that
// separates the two forms, thousands are never introduced, nothing is rounded.

/** Whether a string is a plain number the resolver's `parseFloat` reads whole. */
function isPlainNumber(s: string): boolean {
  return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)
}

/**
 * German number entry → the plain form `parseFloat` reads. Grouping spaces go
 * (that is how {@link formatValue} renders thousands, so it is what a student
 * copies back in); a decimal comma becomes a point, and only then do points
 * count as grouping, which is the German rule.
 *
 * Text that is not a number comes back EXACTLY as typed, spaces and all —
 * rejecting it is not this function's business, the resolver already has
 * documented behaviour for a value it cannot parse, and a student staring at
 * their own mistake should see what they actually wrote.
 */
export function parseGermanEntry(typed: string): string {
  const compact = typed.replace(/\s/g, '')
  const plain = compact.includes(',')
    ? compact.replace(/\./g, '').replace(',', '.')
    : compact
  return isPlainNumber(plain) ? plain : typed
}

/**
 * The inverse: a stored plain number → what a German reader expects to see in
 * an input box. Only the decimal separator changes — no grouping, no rounding
 * — so {@link parseGermanEntry} maps it back to the identical string.
 *
 * Anything that is not a plain number is passed through, so a student's
 * unparseable text stays visible exactly as they typed it.
 */
export function formatGermanEntry(stored: string): string {
  return isPlainNumber(stored) ? stored.replace('.', ',') : stored
}
