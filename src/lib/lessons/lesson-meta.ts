/**
 * lesson-meta — the things the header of a Lernseite says that nobody typed
 * (#107): the number „3.3" and „12 min read".
 *
 * BOTH ARE DERIVED, AND THAT IS THE POINT. A number typed into a page survives
 * the reorder that invalidates it; a reading time typed into a page survives
 * the three paragraphs that were added after it. Deriving them means the header
 * cannot disagree with the page — the only reading time that can be wrong is
 * one the author deliberately overrode.
 *
 * Pure functions over the model, so both the editor's live preview and the
 * student renderer compute the same answer from the same input.
 */

import type { LatestLessonJson, LessonBlock, LessonInline } from './lesson-json'

// ── Numbering ───────────────────────────────────────────────────────────────

/**
 * „3.3" from the page's position in the Kurs tree — chapter 3, lesson 3.
 *
 * Takes a PATH rather than two numbers so the same function keeps working if a
 * level is ever added or removed: `[3]` → „3", `[3, 3]` → „3.3", `[3, 3, 1]` →
 * „3.3.1". The indices are 1-based because the reader counts from one; callers
 * hand it array positions plus one, which is the only arithmetic involved and
 * therefore the only place it can go wrong.
 *
 * Returns '' for an empty path, so a page with no position in a tree (a
 * preview, a draft being written) renders a header with no number rather than a
 * lone separator.
 */
export function formatLessonNumber(path: readonly number[]): string {
  return path.join('.')
}

/**
 * WHO CARRIES THE NUMBER, Unit heading or Lernseite.
 *
 * These two functions exist because the rule has four call sites — the Unit
 * heading, the Lernseite heading, and both navigation trees — and it is not a
 * rule anyone would re-derive the same way twice:
 *
 * - Every Einheit of a LERNKURS is numbered („1"), whether or not it holds
 *   pages yet: it is a chapter, and chapter 2 does not stop being chapter 2
 *   while it is empty. A Musterlösungs-Einheit is not numbered at all — it is a
 *   folder of solutions, and a number would promise a sequence that is not
 *   there.
 * - A Unit holding exactly ONE Lernseite gives that page no number of its own:
 *   the Unit heading IS the page's title there, and „1" above „1.1" saying the
 *   same thing reads as a mistake.
 * - Only from the second page on does a Lernseite number itself („1.1", „1.2").
 *
 * ⚠ THE KURSART DECIDES, NOT THE PAGE COUNT. This took `lessonCount` at first
 * and got it visibly wrong: a freshly created Einheit had no pages yet, so it
 * silently lost its number until someone wrote one — the numbering appeared to
 * come and go on its own. „Is this a Lernkurs" is the question that was
 * actually being asked.
 *
 * Both return a PATH rather than a string, so a caller that wants no separator
 * gets an empty array instead of an empty string to test against.
 */
export function unitNumberPath(unitNumber: number | null, isLernkurs: boolean): number[] {
  return unitNumber !== null && isLernkurs ? [unitNumber] : []
}

export function lessonNumberPath(
  unitNumber: number | null,
  lessonIndex: number,
  lessonCount: number
): number[] {
  return unitNumber === null || lessonCount === 1 ? [] : [unitNumber, lessonIndex + 1]
}

// ── Reading time ────────────────────────────────────────────────────────────

/**
 * Words per minute for prose with mathematics in it.
 *
 * Deliberately slower than the ~250 wpm usually quoted for casual reading: a
 * page that stops to unpack `E[R_P] = x₁E[R₁] + …` is not read at casual speed,
 * and a promise of „5 min" on something that takes fifteen is worse than no
 * promise. This is a judgement call, not a measurement — it lives here as one
 * named constant so it can be re-judged in one place.
 */
export const LESSON_WORDS_PER_MINUTE = 180

/**
 * What „12 min read" resolves to: the author's override if they set one,
 * otherwise the word count over {@link LESSON_WORDS_PER_MINUTE}, rounded up and
 * never below 1 — „0 min read" is not a thing to tell a reader.
 */
export function lessonReadingMinutes(lesson: LatestLessonJson): number {
  if (lesson.readingMinutes !== undefined) return lesson.readingMinutes
  const words = lessonWordCount(lesson)
  return Math.max(1, Math.ceil(words / LESSON_WORDS_PER_MINUTE))
}

/**
 * Words in everything a reader actually reads.
 *
 * FORMULAS COUNT AS ONE WORD EACH, whether they are a lone symbol or a
 * three-line derivation. Counting their LaTeX would be absurd (`\frac{...}`
 * tokenises into nonsense and would inflate a short formula into a paragraph),
 * and counting them as zero would let a page of pure derivation claim a
 * one-minute read. One word each is wrong in both directions by a bounded
 * amount, which is the best an estimate can do.
 *
 * An example's label counts, its icon does not. A video placeholder counts as
 * nothing — there is no video yet, and once there is, its duration will be a
 * fact to add rather than a word count to guess.
 */
export function lessonWordCount(lesson: LatestLessonJson): number {
  return lesson.blocks.reduce((sum, block) => sum + blockWordCount(block), 0)
}

function blockWordCount(block: LessonBlock): number {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
      return richTextWordCount(block.content)
    case 'formula':
    case 'calculation':
      return 1
    case 'example':
      return (
        countWords(block.label) +
        block.blocks.reduce((sum, child) => sum + blockWordCount(child), 0)
      )
    case 'divider':
    case 'video':
      return 0
  }
}

function richTextWordCount(content: readonly LessonInline[]): number {
  return content.reduce((sum, node) => sum + inlineWordCount(node), 0)
}

function inlineWordCount(node: LessonInline): number {
  if (typeof node === 'string') return countWords(node)
  if ('text' in node) return countWords(node.text)
  if (node.type === 'math') return 1
  // A defined term reads as its label; the definition sits behind a hover and
  // is not part of the running text.
  return countWords(node.label)
}

function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

// ── Plain text ──────────────────────────────────────────────────────────────

/**
 * The page as running text — what a search index or a summary would consume.
 * Formulas are dropped rather than rendered as LaTeX: their source is not
 * language, and putting `\frac{a}{b}` into a snippet helps nobody.
 */
export function lessonPlainText(lesson: LatestLessonJson): string {
  return lesson.blocks
    .map(blockPlainText)
    .filter((part) => part !== '')
    .join('\n\n')
}

function blockPlainText(block: LessonBlock): string {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
      return richTextPlainText(block.content)
    case 'example':
      return [block.label, ...block.blocks.map(blockPlainText)]
        .filter((part) => part !== '')
        .join('\n\n')
    case 'formula':
    case 'calculation':
    case 'divider':
    case 'video':
      return ''
  }
}

function richTextPlainText(content: readonly LessonInline[]): string {
  return content
    .map((node) => {
      if (typeof node === 'string') return node
      if ('text' in node) return node.text
      if (node.type === 'math') return ''
      return node.label
    })
    .join('')
    .trim()
}
