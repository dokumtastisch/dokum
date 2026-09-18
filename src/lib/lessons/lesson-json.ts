/**
 * lesson-json — the versioned block model of a Lernseite (#107).
 *
 * This is the second document model in the codebase and it is deliberately NOT
 * the first one. `editor/document-json.ts` describes what the LaTeX editor
 * produces: a flat list of blocks carrying variables, field pills and an
 * expression graph, shaped by a faithful port of a standalone reference editor.
 * A Lernseite is a different thing — prose with worked examples — and forcing
 * it into that schema would mean either widening a model whose parity is pinned
 * by goldens, or pretending a lesson is a calculation sheet. The two live side
 * by side, exactly as decided: the LaTeX editor keeps formula-heavy documents
 * and every existing draft, this one gets the teaching material.
 *
 * WHAT THE MODEL OWES THE DESIGN. Every block type here exists because it is
 * visible in the reference page — the section heading, the prose, the framed
 * key formula, the worked example with its indented calculation step, the rule.
 * Nothing was added „while we're here": no lists, no tables, no columns. The
 * schema is versioned precisely so that adding them later is a v1.1 bump rather
 * than a reason to over-build now.
 *
 * ONE STRUCTURAL DIFFERENCE TO THE LATEX EDITOR, and it is the important one:
 * BLOCKS NEST. An `example` holds blocks of its own. That is what makes the
 * worked example a block rather than a styling convention, and it is what the
 * workspace's drag-and-drop will have to honour — a block can be dropped INTO
 * something. The nesting is exactly one level deep by construction: an example
 * holds {@link LessonLeafBlock}s, which no longer include `example`. Unbounded
 * nesting buys nothing the design shows and costs a recursive schema, a
 * recursive renderer and a drag target that can swallow itself.
 *
 * WHAT IS NOT IN HERE:
 *
 * - **The title.** It lives in its row (`units.title` / `documents.title`),
 *   the single source of truth — the same decision the LaTeX editor's draft
 *   title took (D11). A title in two places drifts.
 * - **The number** („3.3"). It is a fact about where the page sits in the Kurs
 *   tree, so it is derived at render time ({@link formatLessonNumber} in
 *   lesson-meta.ts) and never stored. Storing it would survive a reorder and
 *   start lying.
 * - **The reading time.** Computed from the text unless the author overrides
 *   it, for the same reason.
 *
 * Pure and DOM-free: values in, values out. That is what lets the schema run
 * unchanged in the editor, in a server action and in the student renderer.
 */

import { z } from 'zod'

// ── Inline nodes ────────────────────────────────────────────────────────────

/**
 * A run of text inside a paragraph or heading.
 *
 * A bare string is the common case and stays a bare string — the model should
 * not make „and the results are added up." cost an object. The three richer
 * shapes are the ones the design actually contains: emphasis, an inline formula
 * (`E[R_i]` mid-sentence), and a defined term.
 */
export type LessonInline =
  | string
  | { text: string; bold?: boolean; italic?: boolean }
  | { type: 'math'; latex: string }
  | { type: 'term'; label: string; definition: string }

/**
 * The defined term carries its OWN definition rather than pointing at a
 * glossary table. Self-contained is the cheaper correct answer here: a lesson
 * stays readable from its JSON alone, publishing copies no second table, and a
 * term used once needs no entry anywhere. If a shared glossary is ever wanted,
 * this field becomes its cache and the lift is a v1.1 step — the reverse
 * (starting with a table and discovering most terms are used once) is not.
 */
const TermSchema = z.strictObject({
  type: z.literal('term'),
  label: z.string().min(1),
  definition: z.string().min(1),
})

const MathInlineSchema = z.strictObject({
  type: z.literal('math'),
  latex: z.string(),
})

const StyledTextSchema = z.strictObject({
  text: z.string(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
})

const InlineSchema: z.ZodType<LessonInline> = z.union([
  z.string(),
  StyledTextSchema,
  MathInlineSchema,
  TermSchema,
])

const RichTextSchema = z.array(InlineSchema)

// ── Leaf blocks ─────────────────────────────────────────────────────────────

/**
 * `level` starts at 2 because level 1 is the page title, which is not a block
 * — it is the row's `title`. Allowing an H1 here would let a page grow a second
 * first-level heading that no outline could make sense of.
 */
const HeadingSchema = z.strictObject({
  type: z.literal('heading'),
  level: z.union([z.literal(2), z.literal(3)]),
  content: RichTextSchema,
})

const ParagraphSchema = z.strictObject({
  type: z.literal('paragraph'),
  content: RichTextSchema,
})

/**
 * The framed, centred key formula — „this is the thing to remember". Display
 * math, so it carries LaTeX and no rich text: a formula that needs a sentence
 * around it is a paragraph with an inline formula instead.
 */
const FormulaSchema = z.strictObject({
  type: z.literal('formula'),
  latex: z.string(),
})

/**
 * One worked calculation step — the indented line inside an example that puts
 * real numbers through the formula above it. Structurally a formula, but a
 * separate type because it means something different and is styled as such;
 * collapsing the two would make „key formula" and „arithmetic" indistinguishable
 * in the model, and the design distinguishes them clearly.
 */
const CalculationSchema = z.strictObject({
  type: z.literal('calculation'),
  latex: z.string(),
})

const DividerSchema = z.strictObject({
  type: z.literal('divider'),
})

/**
 * A video, until Bunny exists.
 *
 * It stores no URL and no id ON PURPOSE. The block is here so that authors can
 * place videos while writing and so the workspace, the renderer and the schema
 * already have a slot for them — but nothing about the delivery is decided yet,
 * and a `url` field invented now would be the wrong shape to migrate away from.
 * The renderer shows a labelled placeholder; `title` is what the author already
 * knows about the video they intend to put there.
 */
const VideoPlaceholderSchema = z.strictObject({
  type: z.literal('video'),
  title: z.string().optional(),
})

/** Every block that may appear inside an `example` — i.e. everything but a container. */
const LeafBlockSchema = z.discriminatedUnion('type', [
  HeadingSchema,
  ParagraphSchema,
  FormulaSchema,
  CalculationSchema,
  DividerSchema,
  VideoPlaceholderSchema,
])

export type LessonLeafBlock = z.infer<typeof LeafBlockSchema>

// ── Container block ─────────────────────────────────────────────────────────

/**
 * The worked example: an icon, a label, and blocks of its own.
 *
 * `label` is required and `icon` is not, because the label is what the box
 * announces itself as („A TWO-STOCK PORTFOLIO") while the icon is decoration
 * the design happens to use. An icon is stored as the emoji itself rather than
 * a name from a fixed set — a set would need maintaining, and an emoji is
 * already a portable, self-describing character.
 */
const ExampleSchema = z.strictObject({
  type: z.literal('example'),
  icon: z.string().optional(),
  label: z.string().min(1),
  blocks: z.array(LeafBlockSchema),
})

const BlockSchema = z.discriminatedUnion('type', [
  HeadingSchema,
  ParagraphSchema,
  FormulaSchema,
  CalculationSchema,
  DividerSchema,
  VideoPlaceholderSchema,
  ExampleSchema,
])

export type LessonBlock = z.infer<typeof BlockSchema>

// ── Versioned family ────────────────────────────────────────────────────────

/**
 * Every lesson-JSON version this build can read, OLDEST FIRST; the last entry
 * is the one the editor emits. Same discipline as the document schema
 * (`DOCUMENT_JSON_VERSIONS`): a new block type ships as a new version rather
 * than by loosening the current one, so a stored page is never read as
 * something its version does not describe.
 *
 * Adding a version means all of: append it here, add its schema to the union,
 * move {@link LATEST_LESSON_JSON_VERSION}, and add the vN→vN+1 step in
 * lesson-version.ts — where the upgrade record is total over this list, so a
 * half-done addition fails to compile.
 */
export const LESSON_JSON_VERSIONS = ['1.0'] as const

export type LessonJsonVersion = (typeof LESSON_JSON_VERSIONS)[number]

/** The version the editor emits and the renderer understands. */
export const LATEST_LESSON_JSON_VERSION = '1.0' satisfies LessonJsonVersion

const LessonJsonV1_0Schema = z.strictObject({
  version: z.literal('1.0'),
  /**
   * The small coloured tag above the title („Core Concept"). Free text rather
   * than an enum: the vocabulary is the author's, and a fixed list would have
   * to be guessed now and migrated every time a course wants a word we did not
   * think of. Styling is uniform, so nothing depends on the value.
   */
  badge: z.string().optional(),
  /**
   * Author override for the computed reading time, in minutes. Absent means
   * „derive it" — see `lessonReadingMinutes`.
   */
  readingMinutes: z.number().int().positive().optional(),
  blocks: z.array(BlockSchema),
})

/**
 * The versioned family. A page whose `version` is not in
 * {@link LESSON_JSON_VERSIONS} fails on the `version` path, which is what lets
 * the read boundary refuse it with a clear message instead of letting it fail
 * as an unreadable shape mismatch.
 *
 * A single-member union today, and written as a union anyway: the whole point
 * of the versioning is that member two arrives without touching any caller.
 */
export const LessonJsonSchema = z.discriminatedUnion('version', [LessonJsonV1_0Schema])

/** A page at ANY version this build can read — what the schema parses. */
export type LessonJson = z.infer<typeof LessonJsonSchema>

/**
 * A page at the NEWEST version — what the editor emits and the renderer
 * consumes. Older pages reach this type through the upgrade chain, never by
 * being passed straight through.
 */
export type LatestLessonJson = z.infer<typeof LessonJsonV1_0Schema>

/** A blank Lernseite — what „neue Seite" starts from. */
export function emptyLessonJson(): LatestLessonJson {
  return { version: LATEST_LESSON_JSON_VERSION, blocks: [] }
}
